// 자동 안내 설정 저장 (FRD §4) — owner 전용, Service Role 쓰기
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { parseBody } from "@/lib/validation";

const bodySchema = z.object({
  settings: z.object({
    notification_enabled: z.boolean(),
    sender_phone: z.string().max(20).nullable(),
    business_phone: z.string().max(20).nullable(),
    business_address: z.string().max(200).nullable(),
  }),
  rules: z.array(
    z.object({
      stage: z.enum(["d_7", "d_3", "d_1", "d_day"]),
      enabled: z.boolean(),
      send_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      sms_template_id: z.string().uuid().nullable(),
    })
  ).max(4),
});

export async function PUT(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { settings, rules } = parsed.data;

  // 활성화하려는 규칙에 템플릿이 없으면 거부 (FRD §4.2)
  const invalid = rules.find((r) => r.enabled && !r.sms_template_id);
  if (invalid) {
    return NextResponse.json(
      { error: `문자 템플릿이 지정되지 않아 활성화할 수 없습니다 (${invalid.stage}).` },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { error: sErr } = await service.from("business_notification_settings").upsert({
    business_id: ctx.businessId,
    ...settings,
    updated_at: new Date().toISOString(),
  });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  for (const r of rules) {
    const { error } = await service.from("notification_rules")
      .update({
        enabled: r.enabled,
        send_time: r.send_time,
        sms_template_id: r.sms_template_id,
        updated_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("business_id", ctx.businessId)
      .eq("stage", r.stage);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await service.from("system_audit_logs").insert({
    business_id: ctx.businessId,
    entity_type: "notification_settings",
    action: "update",
    after_data: { settings, rules },
    actor_id: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
