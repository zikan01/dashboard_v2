// 엑셀 파싱·검증·반영 계획 (FRD §9~10, TRD §3.6~3.7)
// 브라우저에서 SheetJS로 파싱하며, 반영은 DataProvider(localStorage)가 수행한다.
// TODO: 2단계에서 반영 대상을 localStorage → Supabase(서버 경유)로 교체

import * as XLSX from "xlsx";
import type {
  PreviewAction,
  Reservation,
  ReservationStatus,
} from "./types";

// ---- 업로드 제한 (악성/비정상 파일 방어 — 서버 검증(src/lib/validation.ts)과 상한 일치) ----

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_ROWS = 2000; // 데이터 행 상한 (사업장 1곳 월 예약 규모 대비 충분)
export const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];
export const ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/octet-stream", // 일부 브라우저/OS가 타입을 못 채우는 경우
  "", // 타입 미제공 — 확장자 검사로 보완
];

// 파일 크기·확장자·MIME 사전 검증 — 통과 못 하면 사유 문자열 반환
export function validateExcelFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return "네이버 예약 상세 엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.";
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return "엑셀 파일 형식이 아닙니다. 파일을 다시 확인해 주세요.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return `파일이 너무 큽니다 (최대 ${MAX_FILE_SIZE / 1024 / 1024}MB). 기간을 나눠 내려받아 주세요.`;
  }
  if (file.size === 0) {
    return "빈 파일입니다.";
  }
  return null;
}

export interface ParsedRow {
  reservationNo: string | null;
  guestName: string;
  guestPhone: string;
  visitStartDate: string;
  visitEndDate: string | null;
  pax: number;
  options: string[];
  paidAmount: number;
  reservationStatus: ReservationStatus;
  channel: string | null;
}

export interface RowError {
  row: number; // 엑셀 행 번호 (1-base)
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: RowError[];
}

// ---- 헤더 자동 탐지: 네이버 예약 상세 엑셀의 다양한 컬럼명을 허용 ----

const FIELD_HEADERS = {
  reservationNo: ["예약번호", "네이버예약번호", "주문번호", "예약id", "예약no"],
  guestName: ["예약자명", "예약자", "구매자명", "방문자명", "고객명", "이름", "성명"],
  guestPhone: [
    "연락처",
    "전화번호",
    "휴대폰번호",
    "휴대전화번호",
    "휴대전화",
    "핸드폰번호",
    "핸드폰",
    "전화",
  ],
  visitStartDate: [
    "이용시작일",
    "이용일시",
    "이용일",
    "이용날짜",
    "이용기간",
    "방문일자",
    "방문일",
    "체크인",
    "시작일",
    "예약일",
  ],
  visitEndDate: ["이용종료일", "체크아웃", "종료일", "퇴실일"],
  pax: ["인원수", "인원", "방문인원", "예약인원", "이용인원"],
  options: [
    "가격분류및옵션",
    "옵션명",
    "옵션",
    "예약옵션",
    "구매옵션",
    "항목",
  ],
  productName: ["객실", "상품명", "예약상품", "이용상품"],
  paidAmount: [
    "결제금액",
    "총결제금액",
    "결제액",
    "결제가격",
    "금액",
    "판매가",
  ],
  reservationStatus: ["예약상태", "진행상태", "처리상태", "상태"],
  channel: ["유입경로", "유입채널", "채널", "경로"],
} as const;

type FieldKey = keyof typeof FIELD_HEADERS;

const normalizeHeader = (v: unknown) =>
  String(v ?? "")
    .replace(/[\s()\[\]·.,_\-:：/]/g, "")
    .toLowerCase();

function detectColumns(grid: unknown[][]) {
  let best: { headerIdx: number; map: Partial<Record<FieldKey, number>> } | null =
    null;
  let bestScore = 0;
  const limit = Math.min(grid.length, 20);
  const keys = Object.keys(FIELD_HEADERS) as FieldKey[];
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? [];
    const map: Partial<Record<FieldKey, number>> = {};
    // 1차: 정확 일치 또는 접두 일치 (강한 매칭)
    row.forEach((cell, col) => {
      const n = normalizeHeader(cell);
      if (!n) return;
      for (const key of keys) {
        if (map[key] !== undefined) continue;
        if (
          FIELD_HEADERS[key].some((c) => {
            const nc = normalizeHeader(c);
            return n === nc || n.startsWith(nc);
          })
        ) {
          map[key] = col;
          break;
        }
      }
    });
    // 2차: 포함 일치 (약한 매칭 — "가격분류 및 옵션" 같은 합성 헤더 대응)
    row.forEach((cell, col) => {
      const n = normalizeHeader(cell);
      if (!n) return;
      if (Object.values(map).includes(col)) return; // 이미 배정된 컬럼 제외
      for (const key of keys) {
        if (map[key] !== undefined) continue;
        if (FIELD_HEADERS[key].some((c) => n.includes(normalizeHeader(c)))) {
          map[key] = col;
          break;
        }
      }
    });
    const score = Object.keys(map).length;
    if (score > bestScore) {
      bestScore = score;
      best = { headerIdx: i, map };
    }
  }
  return best;
}

// ---- 값 파싱 유틸 ----

const pad2 = (n: string | number) => String(n).padStart(2, "0");

// 연도 2자리("26. 7. 17.")와 4자리("2026-07-17") 모두 지원
const DATE_RE = /(\d{2,4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/g;

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 셀 하나에서 날짜(들)를 추출 — "26. 7. 17.(금)~26. 7. 18.(토)" 같은 기간 셀도 지원
function parseDates(v: unknown): string[] {
  if (v == null || v === "") return [];
  if (v instanceof Date && !isNaN(v.getTime())) return [fmtDate(v)];
  const s = String(v).trim();
  const found = [...s.matchAll(DATE_RE)].map((m) => {
    const y = m[1].length <= 2 ? 2000 + Number(m[1]) : Number(m[1]);
    return `${y}-${pad2(m[2])}-${pad2(m[3])}`;
  });
  if (found.length > 0) return found;
  // "7/18", "7.18" — 연도 생략 시 올해로 간주
  const m = s.match(/^(\d{1,2})\s*[\/.월]\s*(\d{1,2})/);
  if (m) return [`${new Date().getFullYear()}-${pad2(m[1])}-${pad2(m[2])}`];
  return [];
}

function parsePhone(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return digits.startsWith("02")
      ? `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
      : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  // 네이버 다운로드 파일은 번호가 마스킹됨(예: ******4158) — 원문 그대로 보존
  if (digits.length >= 3 && s.includes("*")) return s;
  return null;
}

// 상품명·옵션 텍스트에서 인원 추출 — "먹(食)케이션(2인)", "4명" 등
function paxFromText(text: string): number {
  const m = text.match(/(\d+)\s*(?:인|명)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseAmount(v: unknown): number {
  if (typeof v === "number") return Math.round(v);
  const digits = String(v ?? "").replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function parsePax(v: unknown): number {
  if (typeof v === "number") return Math.round(v);
  const m = String(v ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function parseStatus(v: unknown): ReservationStatus {
  const s = String(v ?? "");
  if (/취소|환불/.test(s)) return "cancelled";
  if (/변경/.test(s)) return "changed";
  return "confirmed";
}

function parseOptions(v: unknown): string[] {
  return String(v ?? "")
    .split(/[,/·|+\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- 파일 파싱 ----

export async function parseExcelFile(file: File): Promise<ParseResult> {
  // 크기·확장자·MIME 검증 — 호출부(업로드 페이지)에서도 검사하지만 이중 방어
  const invalid = validateExcelFile(file);
  if (invalid) throw new Error(invalid);

  const wb = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("엑셀 시트를 읽을 수 없습니다.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
  });
  if (grid.length > MAX_ROWS) {
    throw new Error(
      `행이 너무 많습니다 (${grid.length.toLocaleString()}행, 최대 ${MAX_ROWS.toLocaleString()}행). 기간을 나눠 업로드해 주세요.`
    );
  }

  const detected = detectColumns(grid);
  if (
    !detected ||
    detected.map.guestName === undefined ||
    detected.map.guestPhone === undefined ||
    detected.map.visitStartDate === undefined
  ) {
    throw new Error(
      "필수 컬럼(예약자·전화번호·이용기간)을 찾을 수 없습니다. 네이버 예약 상세 엑셀 파일인지 확인해 주세요."
    );
  }
  const { headerIdx, map } = detected;
  const cell = (row: unknown[], key: FieldKey) =>
    map[key] === undefined ? "" : row[map[key]!];

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    if (row.every((c) => String(c ?? "").trim() === "")) continue; // 빈 행

    const rowNo = i + 1;
    const guestName = String(cell(row, "guestName") ?? "").trim();
    const guestPhone = parsePhone(cell(row, "guestPhone"));
    const startDates = parseDates(cell(row, "visitStartDate"));
    const endDates = parseDates(cell(row, "visitEndDate"));

    if (!guestName) {
      errors.push({ row: rowNo, message: "예약자명이 없습니다." });
      continue;
    }
    if (!guestPhone) {
      errors.push({ row: rowNo, message: `${guestName}: 연락처를 읽을 수 없습니다.` });
      continue;
    }
    if (startDates.length === 0) {
      errors.push({ row: rowNo, message: `${guestName}: 이용일 형식을 읽을 수 없습니다.` });
      continue;
    }

    // 상품명(객실)과 옵션을 합쳐 옵션 목록 구성
    const productName = String(cell(row, "productName") ?? "").trim();
    const optionList = parseOptions(cell(row, "options"));
    const options = [
      ...new Set([...(productName ? [productName] : []), ...optionList]),
    ];

    // 인원: 인원 컬럼이 있으면 사용, 없으면 상품명·옵션의 "(2인)"/"4명"에서 추출 (없으면 0)
    let pax = map.pax !== undefined ? parsePax(cell(row, "pax")) : 0;
    if (pax <= 0) pax = paxFromText(`${productName} ${optionList.join(" ")}`);

    const reservationNoRaw = String(cell(row, "reservationNo") ?? "").trim();
    rows.push({
      reservationNo: reservationNoRaw || null,
      guestName,
      guestPhone,
      visitStartDate: startDates[0],
      visitEndDate: endDates[0] ?? startDates[1] ?? null,
      pax,
      options,
      paidAmount: parseAmount(cell(row, "paidAmount")),
      reservationStatus: parseStatus(cell(row, "reservationStatus")),
      channel: String(cell(row, "channel") ?? "").trim() || null,
    });
  }

  // 같은 네이버 예약번호 여러 행(옵션별 행) → 하나의 예약으로 병합 (PRD §5.9)
  const merged: ParsedRow[] = [];
  const byNo = new Map<string, ParsedRow>();
  for (const r of rows) {
    if (!r.reservationNo) {
      merged.push(r);
      continue;
    }
    const prev = byNo.get(r.reservationNo);
    if (!prev) {
      byNo.set(r.reservationNo, r);
      merged.push(r);
    } else {
      prev.options = [...new Set([...prev.options, ...r.options])];
      prev.paidAmount += r.paidAmount;
      prev.pax = Math.max(prev.pax, r.pax);
      if (r.visitStartDate < prev.visitStartDate) prev.visitStartDate = r.visitStartDate;
      if (r.visitEndDate && (!prev.visitEndDate || r.visitEndDate > prev.visitEndDate))
        prev.visitEndDate = r.visitEndDate;
    }
  }

  return { rows: merged, errors };
}

// ---- 반영 계획 (기존 데이터와 비교해 신규/업데이트/병합/취소 분류) ----

export interface PlanItem {
  action: PreviewAction;
  displayNo: string;
  guestName: string;
  detail: string;
  row: ParsedRow;
  targetId?: string;
}

export interface ImportPlan {
  fileName: string;
  items: PlanItem[];
  errors: RowError[];
  counts: {
    total: number;
    create: number;
    update: number;
    merge: number;
    cancel: number;
    error: number;
  };
}

// 표시번호 생성: GMW-YYMMDD-NNN (방문일 기준 일련번호, TRD §1)
export function nextDisplayNo(
  existing: Reservation[],
  visitDate: string,
  taken: Set<string>
): string {
  const prefix = `GMW-${visitDate.slice(2, 4)}${visitDate.slice(5, 7)}${visitDate.slice(8, 10)}-`;
  let max = 0;
  for (const r of existing) {
    if (r.displayNo.startsWith(prefix)) {
      max = Math.max(max, parseInt(r.displayNo.slice(prefix.length), 10) || 0);
    }
  }
  let seq = max + 1;
  let candidate = prefix + String(seq).padStart(3, "0");
  while (taken.has(candidate)) {
    seq += 1;
    candidate = prefix + String(seq).padStart(3, "0");
  }
  taken.add(candidate);
  return candidate;
}

function diffDetail(t: Reservation, p: ParsedRow): string[] {
  const diffs: string[] = [];
  if (t.visitStartDate !== p.visitStartDate)
    diffs.push(`방문일 ${t.visitStartDate.slice(5)} → ${p.visitStartDate.slice(5)}`);
  if (t.pax !== p.pax) diffs.push(`인원 ${t.pax} → ${p.pax}`);
  if (t.paidAmount !== p.paidAmount)
    diffs.push(`금액 ${t.paidAmount.toLocaleString()} → ${p.paidAmount.toLocaleString()}`);
  if (p.options.length > 0 && t.options.join(",") !== p.options.join(","))
    diffs.push(`옵션 변경 (${p.options.join(", ")})`);
  if (t.reservationStatus !== p.reservationStatus) diffs.push("상태 변경");
  return diffs;
}

export function buildImportPlan(
  existing: Reservation[],
  parsed: ParseResult,
  fileName: string
): ImportPlan {
  const items: PlanItem[] = [];
  const taken = new Set<string>();

  for (const p of parsed.rows) {
    // 1) 네이버 예약번호 일치 → 기존 행 업데이트 (TRD §3.7)
    const byNo = p.reservationNo
      ? existing.find((r) => r.reservationNo === p.reservationNo)
      : undefined;
    // 2) 이름+연락처+방문일 일치 → 병합 후보 (텍스트 문의로 먼저 만든 예약 등)
    const byKey = !byNo
      ? existing.find(
          (r) =>
            r.guestName === p.guestName &&
            r.guestPhone === p.guestPhone &&
            r.visitStartDate === p.visitStartDate
        )
      : undefined;
    const target = byNo ?? byKey;

    if (target) {
      const diffs = diffDetail(target, p);
      const gainsNo = !target.reservationNo && !!p.reservationNo;
      if (byKey && gainsNo) {
        items.push({
          action: "merge",
          displayNo: target.displayNo,
          guestName: p.guestName,
          detail: `기존 ${target.displayNo}에 예약번호 연결 (이름+연락처+방문일 일치)${diffs.length ? " · " + diffs.join(" · ") : ""}`,
          row: p,
          targetId: target.id,
        });
      } else if (p.reservationStatus === "cancelled" && target.reservationStatus !== "cancelled") {
        items.push({
          action: "cancel",
          displayNo: target.displayNo,
          guestName: p.guestName,
          detail: "취소 상태로 반영",
          row: p,
          targetId: target.id,
        });
      } else if (diffs.length === 0) {
        items.push({
          action: "skip",
          displayNo: target.displayNo,
          guestName: p.guestName,
          detail: "변경 사항 없음",
          row: p,
          targetId: target.id,
        });
      } else {
        items.push({
          action: "update",
          displayNo: target.displayNo,
          guestName: p.guestName,
          detail: diffs.join(" · "),
          row: p,
          targetId: target.id,
        });
      }
    } else {
      // 신규 — 표시번호 부여
      const displayNo = nextDisplayNo(existing, p.visitStartDate, taken);
      items.push({
        action: p.reservationStatus === "cancelled" ? "cancel" : "create",
        displayNo,
        guestName: p.guestName,
        detail:
          p.reservationStatus === "cancelled"
            ? "취소 예약으로 등록"
            : `${p.options.length ? p.options.join(", ") + " · " : ""}${p.pax}명`,
        row: p,
      });
    }
  }

  return {
    fileName,
    items,
    errors: parsed.errors,
    counts: {
      total: parsed.rows.length + parsed.errors.length,
      create: items.filter((i) => i.action === "create").length,
      update: items.filter((i) => i.action === "update").length,
      merge: items.filter((i) => i.action === "merge").length,
      cancel: items.filter((i) => i.action === "cancel").length,
      error: parsed.errors.length,
    },
  };
}

// ---- 반영: 기존 배열 + 계획 → 새 예약 배열 ----
// ⚠️ 필드 소유권(TRD §3.6): 정산·세금계산서·메모는 절대 덮어쓰지 않는다.

export function applyPlan(existing: Reservation[], plan: ImportPlan): Reservation[] {
  const next = existing.map((r) => ({ ...r }));
  let seq = 0;

  for (const item of plan.items) {
    if (item.action === "skip") continue;
    const p = item.row;

    if (item.targetId) {
      const t = next.find((r) => r.id === item.targetId);
      if (!t) continue;
      // 사실정보만 갱신 (로컬 엑셀이 원본인 필드)
      if (p.reservationNo) t.reservationNo = p.reservationNo;
      t.guestPhone = p.guestPhone;
      t.visitStartDate = p.visitStartDate;
      t.visitEndDate = p.visitEndDate;
      t.pax = p.pax;
      if (p.options.length > 0) t.options = p.options;
      t.paidAmount = p.paidAmount;
      t.reservationStatus = p.reservationStatus;
      if (p.channel) t.channel = p.channel;
    } else {
      const cancelled = p.reservationStatus === "cancelled";
      next.push({
        id: `res-${Date.now()}-${seq++}`,
        displayNo: item.displayNo,
        reservationNo: p.reservationNo,
        source: "excel",
        guestName: p.guestName,
        guestPhone: p.guestPhone,
        visitStartDate: p.visitStartDate,
        visitEndDate: p.visitEndDate,
        pax: p.pax,
        channel: p.channel,
        paidAmount: p.paidAmount,
        reservationStatus: p.reservationStatus,
        options: p.options,
        // 기본값 규칙 (FRD §5): 취소는 해당 없음, 그 외 별도 확인 필요
        settlementStatus: cancelled ? "not_applicable" : "needs_check",
        taxInvoiceStatus: cancelled ? "not_applicable" : "needs_check",
        memo: "",
      });
    }
  }

  return next;
}
