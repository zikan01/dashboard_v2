// 전화번호 정규화·검증 (TRD §16.3)
// 네이버는 방문일 경과 후 번호를 마스킹(******4158)하므로 '*' 포함 값은 무효.

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isValidMobile(raw: string): boolean {
  if (raw.includes("*")) return false;
  return /^01[016789][0-9]{7,8}$/.test(normalizePhone(raw));
}
