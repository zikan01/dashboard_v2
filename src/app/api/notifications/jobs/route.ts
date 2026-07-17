// 발송 작업 액션 (FRD §8·§10) — owner 전용
// send_now·retry는 즉시 Dispatcher를 1회 실행해 결과를 바로 반영한다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { parseBody } from "@/lib/validation";
import { dispatchJobById } from "@/lib/notifications/dispatcher";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";
import { createMockProvider } from "@/lib/notifications/providers/mock-provider";
import type { SendMode } from "@/lib/notifications/types";

const bodySchema = z.object({
  jobId: z.string().uuid(),
  action: z.enum(["send_now", "exclude", "retry", "reschedule"]),
  scheduledAt: z.string().datetime().optional(), // reschedule 전용
});

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { jobId, action, scheduledAt } = parsed.data;

  const service = createServiceClient();
  const { data: job } = await service.from("notification_jobs")
    .select("id, status, business_id").eq("id", jobId).eq("business_id", ctx.businessId).single();
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });

  const now = new Date().toISOString();
  let dispatched = null;

  if (action === "exclude") {
    if (!["scheduled", "failed"].includes(job.status)) {
      return NextResponse.json({ error: "예정 또는 실패 상태만 제외할 수 있습니다." }, { status: 400 });
    }
    await service.from("notification_jobs").update({
      status: "cancelled_by_admin", cancellation_reason: "관리자 제외", updated_at: now,
    }).eq("id", jobId);
  } else if (action === "reschedule") {
    if (job.status !== "scheduled" || !scheduledAt) {
      return NextResponse.json({ error: "예정 상태의 작업만 시각을 바꿀 수 있습니다." }, { status: 400 });
    }
    await service.from("notification_jobs").update({
      scheduled_at: scheduledAt, next_retry_at: null, updated_at: now,
    }).eq("id", jobId);
  } else {
    // send_now: scheduled → 즉시 / retry: failed·cancelled_by_admin → 재발송
    const allowed = action === "send_now" ? ["scheduled"] : ["failed", "cancelled_by_admin"];
    if (!allowed.includes(job.status)) {
      return NextResponse.json({ error: "이 상태에서는 실행할 수 없는 동작입니다." }, { status: 400 });
    }
    const { data: reset, error: resetErr } = await service.from("notification_jobs").update({
      status: "scheduled", scheduled_at: now, next_retry_at: null,
      attempt_count: 0, cancellation_reason: null, updated_at: now,
    }).eq("id", jobId).eq("status", job.status).select("id");
    if (resetErr) {
      // 유니크 제약: 같은 예약·단계에 이미 예정된 안내가 있으면 재발송 불가
      const msg = resetErr.code === "23505"
        ? "이미 같은 안내가 예정되어 있어 재발송할 수 없습니다."
        : resetErr.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if ((reset?.length ?? 0) === 0) {
      return NextResponse.json({ error: "작업 상태가 방금 바뀌었습니다. 새로고침 후 다시 시도하세요." }, { status: 409 });
    }

    const mode = (process.env.NOTIFICATION_SEND_MODE ?? "dry_run") as SendMode;
    const provider = mode === "dry_run" ? createMockProvider() : createSolapiProvider();
    dispatched = await dispatchJobById({
      service, provider, mode,
      allowlist: (process.env.NOTIFICATION_TEST_PHONE_ALLOWLIST ?? "").split(",").map(s => s.trim()).filter(Boolean),
      workerId: `manual-${ctx.userId.slice(0, 8)}`,
      jobId,
    });
    if (dispatched.claimed === 0) {
      return NextResponse.json({ error: "작업이 이미 처리 중입니다." }, { status: 409 });
    }
  }

  await service.from("system_audit_logs").insert({
    business_id: ctx.businessId,
    entity_type: "notification_job",
    entity_id: jobId,
    action,
    after_data: { scheduledAt: scheduledAt ?? null, dispatched },
    actor_id: ctx.userId,
  });
  return NextResponse.json({ ok: true, dispatched });
}
