// 직원 초대 (🔑 대표 전용) — Supabase Auth 초대 메일 발송 + profiles(staff) 생성

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { inviteStaffSchema, parseBody } from "@/lib/validation";

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const parsed = await parseBody(req, inviteStaffSchema);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { email, name } = parsed.data;

  const origin = new URL(req.url).origin;
  const service = createServiceClient();

  const { data, error } = await service.auth.admin.inviteUserByEmail(email.trim(), {
    redirectTo: `${origin}/set-password`,
  });
  if (error || !data.user) {
    const msg = /already/i.test(error?.message ?? "")
      ? "이미 등록된 이메일입니다."
      : `초대 메일 발송에 실패했습니다: ${error?.message ?? "unknown"}`;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { error: profErr } = await service.from("profiles").insert({
    id: data.user.id,
    business_id: ctx.businessId,
    name: name.trim(),
    email: email.trim(),
    role: "staff",
    status: "active",
  });
  if (profErr) {
    return NextResponse.json(
      { error: `프로필 생성에 실패했습니다: ${profErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
