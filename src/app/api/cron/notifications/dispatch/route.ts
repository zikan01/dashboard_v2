// 메시지 발송 Cron (5분 주기) — TRD §13, §14
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/security/cron-auth";
import { dispatchDueJobs } from "@/lib/notifications/dispatcher";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";
import { createMockProvider } from "@/lib/notifications/providers/mock-provider";
import type { SendMode } from "@/lib/notifications/types";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const mode = (process.env.NOTIFICATION_SEND_MODE ?? "dry_run") as SendMode;
  const allowlist = (process.env.NOTIFICATION_TEST_PHONE_ALLOWLIST ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  // dry_run은 외부 발송이 없으므로 SOLAPI 키 없이도 동작해야 한다
  const provider = mode === "dry_run" ? createMockProvider() : createSolapiProvider();

  const summary = await dispatchDueJobs({
    service: createServiceClient(),
    provider,
    mode,
    allowlist,
    workerId: `vercel-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`,
  });
  return NextResponse.json({ ok: true, mode, ...summary });
}
