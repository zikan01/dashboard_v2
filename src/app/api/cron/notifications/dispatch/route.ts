// 메시지 발송 Cron (5분 주기) — TRD §13, §14
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/security/cron-auth";
import { dispatchDueJobs } from "@/lib/notifications/dispatcher";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";
import type { SendMode } from "@/lib/notifications/types";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const mode = (process.env.NOTIFICATION_SEND_MODE ?? "dry_run") as SendMode;
  const allowlist = (process.env.NOTIFICATION_TEST_PHONE_ALLOWLIST ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  const summary = await dispatchDueJobs({
    service: createServiceClient(),
    provider: createSolapiProvider(),
    mode,
    allowlist,
    workerId: `vercel-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`,
  });
  return NextResponse.json({ ok: true, mode, ...summary });
}
