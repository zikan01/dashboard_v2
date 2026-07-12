// 텍스트 문의 규칙 기반 자동 파싱 (무료·오프라인 — 외부 AI 미사용)
// 파싱 결과는 항상 관리자가 확인·수정 후 승격한다 (FRD §12).
// TODO: 2단계 이후 AI 파싱 도입 시에도 이 함수를 폴백으로 유지

import type { ParsedInquiry } from "./types";

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const fmtDate = (dt: Date) => fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());

// ---- 옵션: 키워드 사전 ----
const OPTION_KEYWORDS: [string, RegExp][] = [
  ["바베큐", /바베큐|바비큐|bbq|고기\s*구/i],
  ["계곡", /계곡|물놀이/],
  ["숙박", /숙박|펜션|투숙|\d\s*박|잠잘/],
  ["버스왕복", /버스/],
  ["매실", /매실/],
];

function extractOptions(text: string): string[] {
  return OPTION_KEYWORDS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// ---- 인원: 숫자 + 한글 수사 ----
const KOR_NUM: [string, number][] = [
  ["스물다섯", 25],
  ["스물", 20],
  ["열다섯", 15],
  ["열넷", 14],
  ["열네", 14],
  ["열셋", 13],
  ["열세", 13],
  ["열둘", 12],
  ["열두", 12],
  ["열하나", 11],
  ["열한", 11],
  ["열", 10],
  ["아홉", 9],
  ["여덟", 8],
  ["일곱", 7],
  ["여섯", 6],
  ["다섯", 5],
  ["넷", 4],
  ["네", 4],
  ["셋", 3],
  ["세", 3],
  ["둘", 2],
  ["두", 2],
  ["한", 1],
];

function extractPax(text: string): number | undefined {
  const m = text.match(/(\d+)\s*(?:명|인(?!원)|분(?!께))/);
  if (m) return parseInt(m[1], 10);
  for (const [word, n] of KOR_NUM) {
    if (new RegExp(`${word}\\s*(?:명|분)`).test(text)) return n;
  }
  return undefined;
}

// ---- 연락처 ----
function extractPhone(text: string): string | undefined {
  const m = text.match(/01\d[-\s.]?\d{3,4}[-\s.]?\d{4}/);
  if (!m) return undefined;
  const digits = m[0].replace(/\D/g, "");
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ---- 방문일: 명시적 날짜 + 상대 표현(오늘/내일/이번주·다음주 요일) ----
const DOW_INDEX: Record<string, number> = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6 }; // 월요일 시작

function extractVisitDate(text: string, base: Date): string | undefined {
  // "2026년 7월 18일", "2026-07-18"
  let m = text.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) return fmt(Number(m[1]), Number(m[2]), Number(m[3]));

  // "7월 18일", "7/18" — 이미 지난 날짜면 내년으로
  m = text.match(/(\d{1,2})\s*[\/월.]\s*(\d{1,2})\s*일?/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let y = base.getFullYear();
      if (new Date(y, month - 1, day) < new Date(base.getFullYear(), base.getMonth(), base.getDate()))
        y += 1;
      return fmt(y, month, day);
    }
  }

  // "18일" (요일 표현 제외) — 이번 달 기준, 지났으면 다음 달
  m = text.match(/(?<![\d\/월.])(\d{1,2})\s*일(?!요일)/);
  if (m) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) {
      const cand = new Date(base.getFullYear(), base.getMonth(), day);
      if (cand < base) cand.setMonth(cand.getMonth() + 1);
      return fmtDate(cand);
    }
  }

  // 오늘/내일/모레/글피
  const rel: [RegExp, number][] = [
    [/글피/, 3],
    [/모레/, 2],
    [/내일|낼\s/, 1],
    [/오늘/, 0],
  ];
  for (const [re, days] of rel) {
    if (re.test(text)) {
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      return fmtDate(d);
    }
  }

  // "(이번주|다음주|담주|다다음주)? 토요일"
  m = text.match(/(이번\s*주|다음\s*주|담\s*주|다다음\s*주|차주)?\s*([월화수목금토일])(?:요일|욜)/);
  if (m) {
    const week = (m[1] ?? "").replace(/\s/g, "");
    const dow = DOW_INDEX[m[2]];
    const baseDow = (base.getDay() + 6) % 7; // 월=0
    const weekStart = new Date(base);
    weekStart.setDate(base.getDate() - baseDow); // 이번 주 월요일
    let offset = 0;
    if (week === "다음주" || week === "담주" || week === "차주") offset = 1;
    else if (week === "다다음주") offset = 2;
    const target = new Date(weekStart);
    target.setDate(weekStart.getDate() + offset * 7 + dow);
    // 수식어 없이 "토요일"만 있으면 다가오는 해당 요일로
    if (!week && target < base) target.setDate(target.getDate() + 7);
    return fmtDate(target);
  }

  return undefined;
}

// ---- 예약자명 ----
const NAME_STOPWORDS = /예약|문의|가능|안녕|감사|바베큐|바비큐|계곡|숙박|매실|버스|물놀이|정도|사람|인원|주세요|합니다/;

function extractName(text: string, phone?: string): string | undefined {
  // "김하영입니다", "김하영이에요", "이름은 김하영"
  let m = text.match(/(?:이름은|성함은)\s*([가-힣]{2,4})/);
  if (m && !NAME_STOPWORDS.test(m[1])) return m[1];
  m = text.match(/([가-힣]{2,4})\s*(?:입니다|이에요|예요|이라고|이구요|이고요)/);
  if (m && !NAME_STOPWORDS.test(m[1])) return m[1];
  // 전화번호 바로 앞의 2~4자 한글: "김하영 010-3345-2211"
  if (phone) {
    m = text.match(/([가-힣]{2,4})\s*(?:입니다\s*)?01\d/);
    if (m && !NAME_STOPWORDS.test(m[1])) return m[1];
  }
  return undefined;
}

// 문의 원문 → 파싱 결과 (모든 필드는 best-effort, 관리자가 수정 가능)
export function parseInquiryText(text: string, baseDateStr: string): ParsedInquiry {
  const base = new Date(baseDateStr + "T00:00:00");
  const phone = extractPhone(text);
  const parsed: ParsedInquiry = {};
  const name = extractName(text, phone);
  const visitDate = extractVisitDate(text, base);
  const pax = extractPax(text);
  const options = extractOptions(text);
  if (name) parsed.guestName = name;
  if (phone) parsed.phone = phone;
  if (visitDate) parsed.visitDate = visitDate;
  if (pax) parsed.pax = pax;
  if (options.length > 0) parsed.options = options;
  return parsed;
}
