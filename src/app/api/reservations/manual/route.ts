// 운영상태(정산·세금·메모) 수정 + 감사 로그 기록 — 직원도 가능 (TRD §3.3 manual_status_update)
// ⚠️ 작성자(updated_by/changed_by)는 클라이언트 값이 아닌 서버 세션에서 가져온다 (위조 방지)

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { manualUpdateSchema, parseBody } from "@/lib/validation";

export async function POST(req: Request) {
  const ctx = await requireUser(); // owner + staff 모두 허용
  if (!ctx) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 403 });
  }

  const parsed = await parseBody(req, manualUpdateSchema);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { reservationId, patch, logs } = parsed.data;

  const service = createServiceClient();

  // 같은 사업장의 예약인지 확인 (다른 사업장 데이터 수정 차단)
  const { data: reservation } = await service
    .from("reservations")
    .select("id")
    .eq("id", reservationId)
    .eq("business_id", ctx.businessId)
    .maybeSingle();
  if (!reservation) {
    return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
  }

  const dbPatch: Record<string, string> = {
    updated_by: ctx.userId, // 서버 세션 기준
    updated_at: new Date().toISOString(),
  };
  if (patch.settlementStatus) dbPatch.settlement_status = patch.settlementStatus;
  if (patch.taxInvoiceStatus) dbPatch.tax_invoice_status = patch.taxInvoiceStatus;
  if (patch.memo !== undefined) dbPatch.memo = patch.memo;

  const { error: upErr } = await service
    .from("reservation_manual_statuses")
    .update(dbPatch)
    .eq("reservation_id", reservationId);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (logs.length > 0) {
    const { error: logErr } = await service.from("reservation_audit_logs").insert(
      logs.map((l) => ({
        reservation_id: reservationId,
        field_name: l.fieldName,
        old_value: l.oldValue,
        new_value: l.newValue,
        changed_by: ctx.userId, // 서버 세션 기준 — 클라이언트 값 사용 금지
      }))
    );
    if (logErr) {
      return NextResponse.json({ error: logErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
