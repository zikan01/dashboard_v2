// SMS/LMS 판별과 비용 (PRD §7, §14)
// 기본 단가는 2026-07 solapi.com/pricing 표준 단가(VAT 미포함).
// 운영 단가는 business_notification_settings의 값을 넘겨받아 사용한다.

export const DEFAULT_SMS_COST = 18;
export const DEFAULT_LMS_COST = 45;
export const SMS_BYTE_LIMIT = 90; // EUC-KR 기준

export function eucKrByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return bytes;
}

export function smsType(text: string): "SMS" | "LMS" {
  return eucKrByteLength(text) <= SMS_BYTE_LIMIT ? "SMS" : "LMS";
}

export function estimateCost(
  text: string,
  unit: { smsCost?: number; lmsCost?: number } = {}
): number {
  const { smsCost = DEFAULT_SMS_COST, lmsCost = DEFAULT_LMS_COST } = unit;
  return smsType(text) === "SMS" ? smsCost : lmsCost;
}
