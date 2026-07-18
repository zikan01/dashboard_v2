// 문자 템플릿 변수 치환 (PRD §10)
// 지원 변수: 고객명·방문일·방문시간·인원·옵션·표시번호·예약번호·사업장명·사업장전화·사업장주소

export function renderTemplate(
  body: string,
  vars: Record<string, string | undefined>
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(/#\{([^}]+)\}/g, (whole, key: string) => {
    const v = vars[key];
    if (v === undefined || v === "") {
      missing.push(key);
      return whole;
    }
    return v;
  });
  return { text, missing };
}
