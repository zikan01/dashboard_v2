// Notification Dispatcher (TRD §14~§16, §19)
// Cron API가 호출한다. 외부 API는 DB 트랜잭션 밖에서 실행.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { estimateCost, smsType } from "./cost";
import { decideDispatch, revalidateJob } from "./dispatch-policy";
import { isValidMobile, normalizePhone } from "./phone";
import type { MessageProvider } from "./providers/message-provider";
import { renderTemplate } from "./template-renderer";
import type { JobRow, SendMode } from "./types";
import { formatKoreanDate } from "../utils";

const RETRY_DELAY_MINUTES = [5, 30]; // 1회차 5분, 2회차 30분, 3회차 최종 실패 (TRD §19)
const MAX_ATTEMPTS = 3;

const maskPhoneForLog = (p: string) => {
  const d = normalizePhone(p);
  return d.slice(0, 3) + "****" + d.slice(-4);
};
const hashPhone = (p: string) => {
  const pepper = process.env.PHONE_HASH_PEPPER;
  if (!pepper) throw new Error("PHONE_HASH_PEPPER 환경변수가 설정되지 않았습니다.");
  return createHmac("sha256", pepper).update(normalizePhone(p)).digest("hex");
};

export interface DispatchSummary {
  claimed: number;
  sent: number;
  dryRun: number;
  skipped: number;
  failed: number;
}

export async function dispatchDueJobs(opts: {
  service: SupabaseClient;
  provider: MessageProvider;
  mode: SendMode;
  allowlist: string[];
  workerId: string;
  limit?: number;
}): Promise<DispatchSummary> {
  const { service, provider, mode, allowlist, workerId, limit = 20 } = opts;
  const summary: DispatchSummary = { claimed: 0, sent: 0, dryRun: 0, skipped: 0, failed: 0 };

  const { data: jobs, error } = await service.rpc("claim_due_notification_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (error) throw new Error(`claim 실패: ${error.message}`);
  summary.claimed = jobs?.length ?? 0;

  for (const job of (jobs ?? []) as JobRow[]) {
    try {
      await processJob(service, provider, mode, allowlist, job, summary);
    } catch (e) {
      // 한 건의 예외가 배치 전체를 멈추지 않게 한다 — 재시도 예약
      await scheduleRetryOrFail(service, job, "INTERNAL_ERROR", String(e), summary);
    }
  }
  return summary;
}

// 수동 발송 전용: 대상 Job 1건만 잠금·발송한다.
// 조건부 UPDATE(status='scheduled'일 때만)로 claim하므로 Cron·중복 클릭과 경합해도
// 한쪽만 성공한다 (claimed=0이면 이미 처리 중이거나 상태가 바뀐 것).
export async function dispatchJobById(opts: {
  service: SupabaseClient;
  provider: MessageProvider;
  mode: SendMode;
  allowlist: string[];
  workerId: string;
  jobId: string;
}): Promise<DispatchSummary> {
  const { service, provider, mode, allowlist, workerId, jobId } = opts;
  const summary: DispatchSummary = { claimed: 0, sent: 0, dryRun: 0, skipped: 0, failed: 0 };

  const { data: claimed, error } = await service.from("notification_jobs")
    .update({
      status: "processing",
      locked_at: new Date().toISOString(),
      locked_by: workerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "scheduled")
    .select("*");
  if (error) throw new Error(`단건 claim 실패: ${error.message}`);
  const job = (claimed ?? [])[0] as JobRow | undefined;
  if (!job) return summary; // 이미 처리 중이거나 상태 변경됨

  // 잠금을 확보했으므로 시도 횟수 증가는 별도 UPDATE로 안전
  const attempt = job.attempt_count + 1;
  await service.from("notification_jobs")
    .update({ attempt_count: attempt }).eq("id", jobId);
  job.attempt_count = attempt;

  summary.claimed = 1;
  try {
    await processJob(service, provider, mode, allowlist, job, summary);
  } catch (e) {
    await scheduleRetryOrFail(service, job, "INTERNAL_ERROR", String(e), summary);
  }
  return summary;
}

async function processJob(
  service: SupabaseClient,
  provider: MessageProvider,
  mode: SendMode,
  allowlist: string[],
  job: JobRow,
  summary: DispatchSummary
) {
  // 1) 최신 예약·설정·규칙·템플릿 로드
  const [{ data: res }, { data: settings }, { data: pref }] = await Promise.all([
    service.from("reservations")
      .select("id, guest_name, guest_phone, visit_start_date, reservation_status, display_no, pax")
      .eq("id", job.reservation_id).single(),
    service.from("business_notification_settings")
      .select("*").eq("business_id", job.business_id).single(),
    service.from("reservation_notification_preferences")
      .select("enabled").eq("reservation_id", job.reservation_id).maybeSingle(),
  ]);
  const { data: rule } = job.rule_id
    ? await service.from("notification_rules").select("sms_template_id").eq("id", job.rule_id).single()
    : { data: null };
  const templateId = rule?.sms_template_id ?? null;
  const { data: tpl } = templateId
    ? await service.from("message_templates").select("*").eq("id", templateId).single()
    : { data: null };

  // 멱등 가드: 이 Job으로 이미 발송된 Delivery가 있으면 재발송하지 않는다
  // (발송 성공 후 DB 기록 실패 → 재시도로 이어지는 중복 발송 창을 좁힌다)
  const { data: priorSent } = await service.from("notification_deliveries")
    .select("id").eq("job_id", job.id).in("status", ["sending", "sent", "delivered"]).limit(1);
  if ((priorSent?.length ?? 0) > 0) {
    await service.rpc("recalculate_notification_job_status", { p_job_id: job.id });
    summary.skipped += 1;
    return;
  }

  // 2) 발송 직전 재검증 (TRD §15)
  const { data: succeeded } = await service.from("notification_jobs")
    .select("id").eq("reservation_id", job.reservation_id).eq("stage", job.stage)
    .eq("base_visit_date", job.base_visit_date).eq("status", "success").neq("id", job.id).limit(1);
  const enabled = !!settings?.notification_enabled && (pref === null || pref?.enabled !== false);
  const skip = !res || !tpl
    ? ("notification_disabled" as const)
    : revalidateJob(job, res, enabled, (succeeded?.length ?? 0) > 0);
  if (skip) {
    await service.from("notification_jobs")
      .update({ status: "skipped", cancellation_reason: skip, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    summary.skipped += 1;
    return;
  }

  // 3) 템플릿 치환
  const { data: options } = await service.from("reservation_options")
    .select("option_name").eq("reservation_id", job.reservation_id);
  const rendered = renderTemplate(tpl!.body_text, {
    고객명: res!.guest_name,
    방문일: formatKoreanDate(res!.visit_start_date),
    인원: String(res!.pax ?? ""),
    옵션: (options ?? []).map((o) => o.option_name).join(", ") || "없음",
    표시번호: res!.display_no,
    사업장전화: settings!.business_phone ?? undefined,
    사업장주소: settings!.business_address ?? undefined,
  });
  // 값이 없는 변수는 플레이스홀더가 고객에게 노출되지 않도록 제거하고 기록한다
  const text = rendered.missing.length
    ? rendered.text.replace(/#\{[^}]+\}/g, "").replace(/[ \t]+\n/g, "\n").trim()
    : rendered.text;

  const cost = estimateCost(text, {
    smsCost: Number(settings!.sms_unit_cost),
    lmsCost: Number(settings!.lms_unit_cost),
  });

  // 4) Delivery 생성 (전화번호 원문은 저장하지 않음 — TRD §16.3)
  const { data: delivery, error: dErr } = await service.from("notification_deliveries")
    .insert({
      job_id: job.id,
      template_id: tpl!.id,
      sequence_no: job.attempt_count,
      recipient_masked: maskPhoneForLog(res!.guest_phone),
      recipient_hash: hashPhone(res!.guest_phone),
      content_snapshot: { text, template_version: tpl!.version, sms_type: smsType(text), missing_vars: rendered.missing },
      estimated_cost: cost,
      status: "sending",
      requested_at: new Date().toISOString(),
    })
    .select("id").single();
  if (dErr) throw new Error(`delivery 생성 실패: ${dErr.message}`);

  // 5) 발송 모드 게이트 (TRD §22)
  const decision = decideDispatch(mode, res!.guest_phone, allowlist);
  if (decision.action === "dry_run" || decision.action === "blocked_by_allowlist") {
    await service.from("notification_deliveries")
      .update({ status: "skipped", last_error_message: decision.action, updated_at: new Date().toISOString() })
      .eq("id", delivery!.id);
    await service.from("notification_jobs")
      .update({ status: "skipped", cancellation_reason: decision.action, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    summary.dryRun += 1;
    return;
  }

  // 6) 외부 발송 (트랜잭션 밖)
  if (!isValidMobile(res!.guest_phone)) throw new Error("unreachable: revalidate에서 걸러짐");
  const result = await provider.sendSms({
    to: normalizePhone(res!.guest_phone),
    from: normalizePhone(settings!.sender_phone ?? process.env.SOLAPI_SENDER_NUMBER ?? ""),
    text,
  });

  if (result.ok) {
    await service.from("notification_deliveries").update({
      status: "sent",
      provider_message_id: result.providerMessageId ?? null,
      provider_group_id: result.providerGroupId ?? null,
      provider_message_type: result.messageType ?? null,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", delivery!.id);
    await service.rpc("recalculate_notification_job_status", { p_job_id: job.id });
    summary.sent += 1;
  } else {
    await service.from("notification_deliveries").update({
      status: "failed",
      last_error_code: result.errorCode ?? null,
      last_error_message: result.errorMessage ?? null,
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", delivery!.id);
    await scheduleRetryOrFail(service, job, result.errorCode ?? "SEND_ERROR", result.errorMessage ?? "", summary);
  }
}

// 요청 자체 실패의 재시도 (TRD §19): 5분 → 30분 → 최종 실패
async function scheduleRetryOrFail(
  service: SupabaseClient,
  job: JobRow,
  code: string,
  message: string,
  summary: DispatchSummary
) {
  if (job.attempt_count < MAX_ATTEMPTS) {
    const delay = RETRY_DELAY_MINUTES[job.attempt_count - 1] ?? 30;
    await service.from("notification_jobs").update({
      status: "scheduled",
      next_retry_at: new Date(Date.now() + delay * 60_000).toISOString(),
      locked_at: null, locked_by: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
  } else {
    await service.from("notification_jobs").update({
      status: "failed",
      cancellation_reason: `${code}: ${message}`.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    summary.failed += 1;
  }
}
