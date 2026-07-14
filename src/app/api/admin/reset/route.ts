// 전체 데이터 초기화 (🔑 대표 전용) — 예약·업로드 이력·수정 이력·문의 삭제
// DB 함수 reset_business_data(마이그레이션 0003) 안에서 단일 트랜잭션으로 실행된다.
// 중간 실패 시 전부 롤백 → 절반만 지워진 상태가 남지 않음.

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";

export async function POST() {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const service = createServiceClient();
  const { error } = await service.rpc("reset_business_data", {
    p_business_id: ctx.businessId,
  });

  if (!error) {
    return NextResponse.json({ ok: true });
  }

  // 함수 미설치(마이그레이션 미적용) — 데이터 변경 없음
  if (error.code === "PGRST202") {
    return NextResponse.json(
      { error: "DB 마이그레이션(0003)이 적용되지 않았습니다. supabase/migrations/0003_mentor_feedback_4.sql을 실행해 주세요." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: `데이터를 초기화하지 못했습니다 (변경 사항 없음, 전체 롤백됨): ${error.message}` },
    { status: 500 }
  );
}
