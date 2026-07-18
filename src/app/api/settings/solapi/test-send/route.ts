// SOLAPI 테스트 발송 (FRD §7) — owner 전용, allowlist 번호로만 발송
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { parseBody } from "@/lib/validation";
import { normalizePhone } from "@/lib/notifications/phone";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";
import { estimateCost, smsType } from "@/lib/notifications/cost";

const bodySchema = z.object({ to: z.string().min(9).max(20) });

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const to = normalizePhone(parsed.data.to);
  const allowlist = (process.env.NOTIFICATION_TEST_PHONE_ALLOWLIST ?? "")
    .split(",").map(normalizePhone).filter(Boolean);
  if (!allowlist.includes(to)) {
    return NextResponse.json(
      { error: "테스트 발송은 등록된 테스트 번호로만 가능합니다 (NOTIFICATION_TEST_PHONE_ALLOWLIST)." },
      { status: 400 }
    );
  }
  const text = "[고마워할매] 솔라피 연결 테스트 문자입니다.";
  const result = await createSolapiProvider().sendSms({
    to,
    from: normalizePhone(process.env.SOLAPI_SENDER_NUMBER ?? ""),
    text,
  });
  if (!result.ok) {
    return NextResponse.json({ error: `${result.errorCode}: ${result.errorMessage}` }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    messageType: result.messageType ?? smsType(text),
    cost: estimateCost(text),
  });
}
