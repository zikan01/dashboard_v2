// SOLAPI 연결 상태 (FRD §7) — owner 전용. Secret 원문은 절대 반환하지 않는다.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";

export async function GET() {
  const ctx = await requireUser("owner");
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });

  const keyRegistered = !!process.env.SOLAPI_API_KEY && !!process.env.SOLAPI_API_SECRET;
  const senderNumber = process.env.SOLAPI_SENDER_NUMBER ?? null;
  const mode = process.env.NOTIFICATION_SEND_MODE ?? "dry_run";
  let balance: number | null = null;
  let connected = false;
  if (keyRegistered) {
    try {
      balance = await createSolapiProvider().getBalance();
      connected = true;
    } catch {
      connected = false;
    }
  }
  return NextResponse.json({
    ok: true,
    keyRegistered,
    connected,
    balance,
    senderNumber: senderNumber ? senderNumber.slice(0, 3) + "****" + senderNumber.slice(-4) : null,
    mode,
    checkedAt: new Date().toISOString(),
  });
}
