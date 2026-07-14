// 엑셀 업로드 반영 — 예약 사실정보 쓰기는 서버(Service Role)만 (TRD §3.3)
// ⚠️ 필드 소유권(§3.6): reservation_manual_statuses는 절대 UPDATE하지 않는다.
//    신규 예약일 때만 기본값 생성.
//
// 전체 반영은 DB 함수 apply_import_plan(마이그레이션 0003) 안에서 단일 트랜잭션으로
// 실행된다(all-or-nothing). 중간 실패 시 전부 롤백되고, 실패 사유는
// import_batches(status='failed').error_message에 남는다.

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { importPlanSchema, parseBody } from "@/lib/validation";

export async function POST(req: Request) {
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
