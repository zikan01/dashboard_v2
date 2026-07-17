// 관리자 설정 API (TRD 핸드오프 §4.3) — 전부 owner 전용
// GET  → { passwordSet, tokenIssuedAt }  (값 자체는 절대 반환하지 않음)
// POST { password }         → AES-256-GCM 암호화 저장
// POST { issueToken: true } → 수집기 토큰 발급 (해시만 저장, 원문 1회만 응답)
// ⚠️ 비밀번호·토큰 원문은 로그·에러 메시지에 출력 금지

import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptSetting, generateCollectorToken, hashToken } from "@/lib/crypto";
import { createServiceClient, requireUser } from "@/lib/supabase/server";

const KEY_PASSWORD = "excel_file_password";
const KEY_TOKEN_HASH = "collector_token_hash";

const settingsSchema = z
  .object({
    password: z.string().min(1, "비밀번호를 입력해주세요").max(64).optional(),
    issueToken: z.literal(true).optional(),
  })
  .refine((v) => (v.password !== undefined) !== (v.issueToken === true), {
    message: "password 또는 issueToken 중 하나만 보내야 합니다.",
  });

export async function GET() {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const service = createServiceClient();
  const { data, error } = await service
    .from("app_settings")
    .select("key, updated_at")
    .in("key", [KEY_PASSWORD, KEY_TOKEN_HASH]);
  if (error) {
    // 테이블 미생성(마이그레이션 0004 미적용)도 여기로 온다
    return NextResponse.json(
      { error: "설정을 조회하지 못했습니다. DB 마이그레이션(0004_addon.sql) 적용 여부를 확인해 주세요." },
      { status: 500 }
    );
  }
  const tokenRow = data?.find((r) => r.key === KEY_TOKEN_HASH);
  return NextResponse.json({
    passwordSet: !!data?.some((r) => r.key === KEY_PASSWORD),
    tokenIssuedAt: tokenRow?.updated_at ?? null,
  });
}

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "입력이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  if (parsed.data.password !== undefined) {
    let encrypted: string;
    try {
      encrypted = encryptSetting(parsed.data.password);
    } catch (e) {
      // SETTINGS_ENCRYPTION_KEY 미설정 등 — 원문 흔적 없는 메시지만 전달
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "암호화에 실패했습니다." },
        { status: 500 }
      );
    }
    const { error } = await service.from("app_settings").upsert({
      key: KEY_PASSWORD,
      value: encrypted,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      return NextResponse.json(
        { error: "비밀번호 저장에 실패했습니다. 다시 시도해 주세요." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, passwordSet: true });
  }

  // issueToken: 재발급 시 이전 토큰은 즉시 무효화된다 (해시 교체)
  const token = generateCollectorToken();
  const issuedAt = new Date().toISOString();
  const { error } = await service.from("app_settings").upsert({
    key: KEY_TOKEN_HASH,
    value: hashToken(token),
    updated_by: ctx.userId,
    updated_at: issuedAt,
  });
  if (error) {
    return NextResponse.json(
      { error: "토큰 발급에 실패했습니다. 다시 시도해 주세요." },
      { status: 500 }
    );
  }
  // 원문은 이 응답 1회만 — DB에는 해시만 있어 재조회 불가
  return NextResponse.json({ ok: true, token, tokenIssuedAt: issuedAt });
}
