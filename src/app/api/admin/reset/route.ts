// 전체 데이터 초기화 (🔑 대표 전용) — 예약·업로드 이력·수정 이력·문의 삭제

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";

export async function POST() {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const service = createServiceClient();
  // 예약 삭제 → 옵션·운영상태·수정이력 CASCADE / 배치 삭제 → 배치항목 CASCADE
  const r1 = await service
    .from("reservations")
    .delete()
    .eq("business_id", ctx.businessId);
  const r2 = await service
    .from("import_batches")
    .delete()
    .eq("business_id", ctx.businessId);
  const r3 = await service
    .from("reservation_inquiries")
    .delete()
    .eq("business_id", ctx.businessId);

  const error = r1.error ?? r2.error ?? r3.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
