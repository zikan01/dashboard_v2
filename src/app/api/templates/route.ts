// 문자 템플릿 CRUD (FRD §5) — owner 전용
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { parseBody } from "@/lib/validation";

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  purpose: z.enum(["d_7", "d_3", "d_1", "d_day", "manual"]),
  body_text: z.string().min(1).max(2000),
  is_active: z.boolean().default(true),
});
const deleteSchema = z.object({ id: z.string().uuid() });

const guard = async () => {
  const ctx = await requireUser("owner");
  return ctx ?? null;
};

export async function POST(req: Request) {
  const ctx = await guard();
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, upsertSchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const service = createServiceClient();
  const { id: _ignore, ...data } = parsed.data;
  const { data: row, error } = await service.from("message_templates")
    .insert({ ...data, business_id: ctx.businessId, created_by: ctx.userId, updated_by: ctx.userId })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: row.id });
}

export async function PUT(req: Request) {
  const ctx = await guard();
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, upsertSchema.required({ id: true }));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { id, ...data } = parsed.data;
  const service = createServiceClient();
  // 본문이 바뀌면 버전을 올린다 (발송 이력의 템플릿 버전 추적용)
  const { data: prev } = await service.from("message_templates")
    .select("body_text, version").eq("id", id).eq("business_id", ctx.businessId).single();
  if (!prev) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
  const { error } = await service.from("message_templates")
    .update({
      ...data,
      version: prev.body_text === data.body_text ? prev.version : prev.version + 1,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id).eq("business_id", ctx.businessId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await guard();
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, deleteSchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const service = createServiceClient();
  const { error } = await service.from("message_templates")
    .delete().eq("id", parsed.data.id).eq("business_id", ctx.businessId);
  if (error) {
    // FK 제약: 규칙이 참조 중이면 삭제 불가
    const msg = error.code === "23503"
      ? "자동 안내 규칙이 사용 중인 템플릿입니다. 규칙에서 먼저 해제하세요."
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
