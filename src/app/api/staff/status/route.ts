// 직원 활성/비활성화 (🔑 대표 전용) — 비활성 계정은 로그인·RLS 접근 모두 차단됨

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const { id, status } = (await req.json()) as {
    id: string;
    status: "active" | "inactive";
  };
  if (!id || !["active", "inactive"].includes(status)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (id === ctx.userId) {
    return NextResponse.json(
      { error: "본인 계정은 비활성화할 수 없습니다." },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { error } = await service
    .from("profiles")
    .update({ status })
    .eq("id", id)
    .eq("business_id", ctx.businessId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
