// 서버 전용 암호화 유틸 (TRD 핸드오프 §5)
// - 설정값(엑셀 파일 비밀번호): AES-256-GCM 암호문 "iv:tag:cipher" (각 base64)
// - 수집기 토큰: sha256 hex 해시만 저장 (복원 불가)
// ⚠️ 실패 시 에러 메시지·로그에 원문 흔적을 남기지 않는다.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function getKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("SETTINGS_ENCRYPTION_KEY 환경변수가 설정되지 않았습니다. (openssl rand -base64 32)");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SETTINGS_ENCRYPTION_KEY는 32바이트를 base64 인코딩한 값이어야 합니다.");
  }
  return key;
}

export function encryptSetting(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

// 복호화 실패(형식 오류·키 불일치·변조)는 null — 원문·사유를 노출하지 않음
export function decryptSetting(stored: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = stored.split(":");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// 수집기 토큰 발급: 32바이트 랜덤 → base64url (원문은 발급 응답 1회만 노출)
export function generateCollectorToken(): string {
  return randomBytes(32).toString("base64url");
}
