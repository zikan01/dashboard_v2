// 예약 1건 삭제 (🔑 대표 전용) — 옵션·운영상태·수정이력 CASCADE 삭제

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const { id } = (await req.json()) as { id: string };
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  const service = createServiceClient();
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
