// 엑셀 업로드 반영 — 예약 사실정보 쓰기는 서버(Service Role)만 (TRD §3.3)
// ⚠️ 필드 소유권(§3.6): reservation_manual_statuses는 절대 UPDATE하지 않는다.
//    신규 예약일 때만 기본값 생성.
//
// 전체 반영은 DB 함수 apply_import_plan(마이그레이션 0003) 안에서 단일 트랜잭션으로
// 실행된다(all-or-nothing). 중간 실패 시 전부 롤백되고, 실패 사유는
// import_batches(status='failed').error_message에 남는다.
//
// [증분 2026-07-17 — TRD 핸드오프 §4.1]
// - JSON 본문(기존): 클라이언트가 만든 ImportPlan 반영 — 기존 동작 그대로 (회귀 없음)
// - multipart 본문(신규): 파일 수신 + mode=preview|auto_apply
//   · CFB 시그니처(D0 CF 11 E0) 감지 → app_settings의 비밀번호로 officecrypto-tool 복호화
//     → 평문 buffer를 "기존 파서(lib/excel.ts)"에 그대로 전달 (파서 무수정)
//   · preview: 서버가 계획을 만들어 반환 → 화면은 기존 미리보기·반영 흐름 그대로
//   · auto_apply: 기존 apply_import_plan RPC를 그대로 호출(운영상태 무변경 규칙 자동 준수)
//     후 배치 source만 'local_collector'로 기록
//   · 인증: 관리자 세션 (수집기 토큰 인증은 수집기 미사용 확정으로 제거됨)

import { NextResponse } from "next/server";
import * as officeCrypto from "officecrypto-tool";
import { decryptSetting } from "@/lib/crypto";
import {
  buildImportPlan,
  parseExcelFile,
  validateExcelFile,
  type ImportPlan,
} from "@/lib/excel";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import type { Reservation } from "@/lib/types";
import { importPlanSchema, parseBody } from "@/lib/validation";

// MS 복합 파일(CFB) 시그니처 — 암호화된 OOXML은 CFB 컨테이너에 담긴다
const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return handleFileUpload(req);
  }
  return handlePlanApply(req);
}

// ============================================================
// 기존 경로: ImportPlan JSON 반영 (변경 없음)
// ============================================================

async function handlePlanApply(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  // 클라이언트가 만든 ImportPlan을 그대로 신뢰하지 않는다 — 크기·형식·범위 검증
  const parsed = await parseBody(req, importPlanSchema);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { plan } = parsed.data;

  const service = createServiceClient();

  // 단일 트랜잭션 반영 — 행별 반복 쿼리 대신 RPC 1회 호출 (DoS/비용 완화)
  const { error } = await service.rpc("apply_import_plan", {
    p_business_id: ctx.businessId,
    p_user_id: ctx.userId,
    p_file_name: plan.fileName,
    p_items: plan.items,
    p_counts: plan.counts,
  });

  if (!error) {
    return NextResponse.json({ ok: true });
  }

  // 함수 미설치(마이그레이션 미적용) — 데이터 변경 없음, 배치 기록도 생략
  if (error.code === "PGRST202") {
    return NextResponse.json(
      { error: "DB 마이그레이션(0003)이 적용되지 않았습니다. supabase/migrations/0003_mentor_feedback_4.sql을 실행해 주세요." },
      { status: 500 }
    );
  }

  // 트랜잭션 전체 롤백됨 — 실패 배치를 사유와 함께 기록
  await service.from("import_batches").insert({
    business_id: ctx.businessId,
    source: "excel",
    file_name: plan.fileName,
    uploaded_by: ctx.userId,
    status: "failed",
    total_count: plan.counts.total,
    error_count: plan.counts.error,
    error_message: error.message,
  });
  return NextResponse.json(
    { error: `예약 데이터를 저장하지 못했습니다 (변경 사항 없음, 전체 롤백됨): ${error.message}` },
    { status: 500 }
  );
}

// ============================================================
// 신규 경로: 파일 업로드 (복호화 + preview / auto_apply)
// ============================================================

interface UploadIdentity {
  businessId: string;
  userId: string | null;
}

async function handleFileUpload(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const identity: UploadIdentity = { businessId: ctx.businessId, userId: ctx.userId };

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart 본문을 읽을 수 없습니다." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file 필드에 엑셀 파일을 첨부해 주세요." }, { status: 400 });
  }
  const mode = String(form.get("mode") ?? "preview");
  if (mode !== "preview" && mode !== "auto_apply") {
    return NextResponse.json({ error: "mode는 preview 또는 auto_apply여야 합니다." }, { status: 400 });
  }

  // 크기·확장자·MIME — 기존 웹 업로드와 동일 기준 (lib/excel.ts)
  const invalid = validateExcelFile(file);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  const service = createServiceClient();

  // 1) 암호화 감지: CFB 시그니처 + officecrypto-tool 판정 (일반 구형 .xls도 CFB라 이중 확인)
  if (buffer.subarray(0, 8).equals(CFB_SIGNATURE) && officeCrypto.isEncrypted(buffer)) {
    const { data: row, error: settingsError } = await service
      .from("app_settings")
      .select("value")
      .eq("key", "excel_file_password")
      .maybeSingle();
    if (settingsError || !row?.value) {
      return NextResponse.json(
        { error: "암호화된 파일입니다. 비밀번호를 먼저 등록해주세요", code: "password_not_set" },
        { status: 400 }
      );
    }
    const password = decryptSetting(String(row.value));
    if (!password) {
      // 저장된 암호문을 풀 수 없음(키 교체 등) — 재등록 필요
      return NextResponse.json(
        { error: "저장된 비밀번호를 사용할 수 없습니다. 비밀번호를 다시 등록해주세요", code: "password_not_set" },
        { status: 400 }
      );
    }
    try {
      buffer = await officeCrypto.decrypt(buffer, { password });
    } catch {
      return NextResponse.json(
        { error: "파일 비밀번호가 맞지 않습니다", code: "password_mismatch" },
        { status: 400 }
      );
    }
  }

  // 2) 평문 buffer를 기존 파서에 그대로 전달 (lib/excel.ts 무수정 — Node 20+ File 전역)
  let parsed;
  try {
    parsed = await parseExcelFile(new File([new Uint8Array(buffer)], file.name));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "파일을 읽지 못했습니다." },
      { status: 400 }
    );
  }
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    return NextResponse.json({ error: "파일에서 예약 데이터를 찾지 못했습니다." }, { status: 400 });
  }

  // 3) 기존 예약과 비교해 반영 계획 생성 (클라이언트 buildImportPlan과 동일 로직 재사용)
  const { data: rows, error: fetchError } = await service
    .from("reservations")
    .select(
      "id, display_no, reservation_no, source, guest_name, guest_phone, visit_start_date, visit_end_date, pax, channel, paid_amount, reservation_status, reservation_options(option_name)"
    )
    .eq("business_id", identity.businessId);
  if (fetchError) {
    return NextResponse.json({ error: "기존 예약을 조회하지 못했습니다." }, { status: 500 });
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const existing: Reservation[] = (rows ?? []).map((row: any) => ({
    id: row.id,
    displayNo: row.display_no,
    reservationNo: row.reservation_no,
    source: row.source,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    visitStartDate: row.visit_start_date,
    visitEndDate: row.visit_end_date,
    pax: row.pax,
    channel: row.channel,
    paidAmount: row.paid_amount,
    reservationStatus: row.reservation_status,
    options: (row.reservation_options ?? []).map((o: any) => o.option_name),
    // 계획 생성에는 쓰이지 않는 운영상태 필드 — 기본값으로 채움 (덮어쓰기와 무관)
    settlementStatus: "needs_check",
    taxInvoiceStatus: "needs_check",
    memo: "",
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const plan = buildImportPlan(existing, parsed, file.name);

  // 4) preview: 계획만 반환 — 화면이 기존 미리보기·반영(JSON 경로) 흐름을 그대로 사용
  if (mode === "preview") {
    return NextResponse.json({ plan });
  }

  // 5) auto_apply: 기존 반영 로직(RPC) 그대로 호출 — 미리보기 확인만 생략 (TRD §1)
  return applyPlanDirect(service, identity, plan);
}

async function applyPlanDirect(
  service: ReturnType<typeof createServiceClient>,
  identity: UploadIdentity,
  plan: ImportPlan
) {
  if (plan.items.length === 0) {
    return NextResponse.json({ error: "반영할 예약이 없습니다." }, { status: 400 });
  }

  const { data: batchId, error } = await service.rpc("apply_import_plan", {
    p_business_id: identity.businessId,
    p_user_id: identity.userId,
    p_file_name: plan.fileName,
    p_items: plan.items,
    p_counts: plan.counts,
  });

  if (error) {
    if (error.code === "PGRST202") {
      return NextResponse.json(
        { error: "DB 마이그레이션(0003)이 적용되지 않았습니다. supabase/migrations/0003_mentor_feedback_4.sql을 실행해 주세요." },
        { status: 500 }
      );
    }
    await service.from("import_batches").insert({
      business_id: identity.businessId,
      source: "local_collector",
      file_name: plan.fileName,
      uploaded_by: identity.userId,
      status: "failed",
      total_count: plan.counts.total,
      error_count: plan.counts.error,
      error_message: error.message,
    });
    return NextResponse.json(
      { error: `예약 데이터를 저장하지 못했습니다 (변경 사항 없음, 전체 롤백됨): ${error.message}` },
      { status: 500 }
    );
  }

  // 업로드 이력에 방식 "로컬 수집기"로 표시 (RPC는 기존 그대로 두고 배치 출처만 갱신)
  await service
    .from("import_batches")
    .update({ source: "local_collector" })
    .eq("id", batchId as string);

  const skipped = plan.items.filter((i) => i.action === "skip").length;
  return NextResponse.json({
    batchId,
    total: plan.counts.total,
    new: plan.counts.create,
    updated: plan.counts.update + plan.counts.merge,
    cancelled: plan.counts.cancel,
    skipped,
    errors: plan.counts.error,
  });
}
