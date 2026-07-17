// SOLAPI 메시지 리포트 Webhook (TRD §17)
// 검증: X-SOLAPI-EVENT-NAME + X-SOLAPI-SECRET 고정 시크릿 비교 (HMAC 아님)
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const reportItem = z.object({
  messageId: z.string(),
  statusCode: z.string(),
  type: z.string().optional(),
  dateReceived: z.string().optional(),
}).passthrough();
const reportSchema = z.array(reportItem).min(1).max(1000);

export async function POST(req: Request) {
  const secret = process.env.SOLAPI_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-solapi-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const eventName = req.headers.get("x-solapi-event-name") ?? "UNKNOWN";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const service = createServiceClient();
  for (const msg of parsed.data) {
    const eventKey = createHash("sha256")
      .update(`${msg.messageId}:${msg.statusCode}:${msg.dateReceived ?? ""}`)
      .digest("hex");

    // 중복 이벤트 차단 (event_key UNIQUE) — 이미 처리한 이벤트는 조용히 건너뜀
    const { error: insErr } = await service.from("provider_webhook_events").insert({
      event_key: eventKey,
      event_type: eventName,
      provider_message_id: msg.messageId,
      payload: msg,
    });
    if (insErr) continue; // 23505 duplicate 포함

    const isSuccess = msg.statusCode === "4000";
    const { data: delivery } = await service.from("notification_deliveries")
      .select("id, job_id")
      .eq("provider_message_id", msg.messageId)
      .maybeSingle();
    if (!delivery) continue; // 알 수 없는 메시지 — 이벤트만 보관

    await service.from("notification_deliveries").update(
      isSuccess
        ? { status: "delivered", delivered_at: new Date().toISOString(),
            provider_raw_last_event: msg, updated_at: new Date().toISOString() }
        : { status: "failed", last_error_code: msg.statusCode,
            failed_at: new Date().toISOString(),
            provider_raw_last_event: msg, updated_at: new Date().toISOString() }
    ).eq("id", delivery.id);

    await service.rpc("recalculate_notification_job_status", { p_job_id: delivery.job_id });
    await service.from("provider_webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("event_key", eventKey);
  }
  return NextResponse.json({ ok: true });
}
