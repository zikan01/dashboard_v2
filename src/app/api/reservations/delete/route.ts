// 예약 1건 삭제 (🔑 대표 전용) — 옵션·운영상태·수정이력 CASCADE 삭제

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { deleteReservationSchema, parseBody } from "@/lib/validation";

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const parsed = await parseBody(req, deleteReservationSchema);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { id } = parsed.data;

  const service = createServiceClient();

  // 승격된 문의가 이 예약을 FK(promoted_reservation_id)로 참조하면 삭제가 막히므로 먼저 연결 해제
  // (문의 원문·상태는 보존)
  const { error: unlinkErr } = await service
    .from("reservation_inquiries")
    .update({ promoted_reservation_id: null })
    .eq("promoted_reservation_id", id)
    .eq("business_id", ctx.businessId);
  if (unlinkErr) {
    return NextResponse.json({ error: unlinkErr.message }, { status: 500 });
  }

  const { error } = await service
    .from("reservations")
    .delete()
    .eq("id", id)
    .eq("business_id", ctx.businessId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
