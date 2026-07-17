// Provider 상태 대조 Cron (30분 주기) — TRD §13, §18
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/security/cron-auth";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = createServiceClient();
  const provider = createSolapiProvider();
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();

  const { data: pending } = await service.from("notification_deliveries")
    .select("id, job_id, provider_message_id")
    .in("status", ["sending", "sent"])
    .not("provider_message_id", "is", null)
    .lt("sent_at", cutoff)
    .limit(50);

  let updated = 0;
  for (const d of pending ?? []) {
    const s = await provider.getMessageStatus(d.provider_message_id!);
    if (s.status === "delivered") {
      await service.from("notification_deliveries")
        .update({ status: "delivered", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", d.id);
    } else if (s.status === "failed") {
      await service.from("notification_deliveries")
        .update({ status: "failed", last_error_code: s.errorCode ?? null, failed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", d.id);
    } else {
      continue;
    }
    await service.rpc("recalculate_notification_job_status", { p_job_id: d.job_id });
    updated += 1;
  }
  return NextResponse.json({ ok: true, checked: pending?.length ?? 0, updated });
}
