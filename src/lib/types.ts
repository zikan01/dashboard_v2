// TRD §3 DB 스키마와 1:1 매핑되는 타입 (snake_case → camelCase)
// 2단계 Supabase 연동 시 이 타입을 그대로 유지하고 데이터 소스만 교체한다.

export type ReservationSource = "excel" | "local_collector" | "text_inquiry";
export type ReservationStatus = "confirmed" | "changed" | "cancelled";
export type SettlementStatus = "needs_check" | "completed" | "not_applicable";
export type TaxInvoiceStatus = "needs_check" | "issued" | "not_applicable";
export type InquiryStatus = "pending" | "confirmed" | "rejected";
export type BatchStatus = "applied" | "failed" | "reverted";
export type StaffRole = "owner" | "staff";

export interface Reservation {
  id: string;
  displayNo: string; // 자체 PK 표시번호 GMW-YYMMDD-NNN
  reservationNo: string | null; // 네이버 예약번호 (텍스트 문의면 null)
  source: ReservationSource;
  guestName: string;
  guestPhone: string;
  visitStartDate: string; // YYYY-MM-DD
  visitEndDate: string | null;
  pax: number;
  channel: string | null; // 유입경로 (네이버 플레이스 등)
  paidAmount: number;
  reservationStatus: ReservationStatus;
  options: string[];
  // reservation_manual_statuses (Supabase 소유 — 업로드로 덮어쓰기 금지)
  settlementStatus: SettlementStatus;
  taxInvoiceStatus: TaxInvoiceStatus;
  memo: string; // ⚠️ 반드시 문자열로 저장·표시 (객체 금지 — v1 [object Object] 버그 수정)
}

export interface AuditLog {
  id: string;
  reservationId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  changedBy: string;
  changedAt: string; // MM-DD HH:mm
}

export interface ParsedInquiry {
  guestName?: string;
  phone?: string;
  visitDate?: string;
  pax?: number;
  options?: string[];
}

export interface Inquiry {
  id: string;
  rawText: string; // 원문 보존
  parsed: ParsedInquiry;
  status: InquiryStatus;
  mergeCandidateDisplayNo: string | null;
  createdAt: string;
}

export interface ImportBatch {
  id: string;
  executedAt: string;
  executedBy: string;
  source: ReservationSource;
  status: BatchStatus;
  totalCount: number;
  appliedCount: number;
  errorCount: number;
  localFileSaved: boolean | null; // 로컬 엑셀 저장 성공 여부 (해당 없으면 null)
}

export type PreviewAction =
  | "create"
  | "update"
  | "merge"
  | "change"
  | "cancel"
  | "skip"
  | "error";

export interface PreviewItem {
  displayNo: string;
  guestName: string;
  action: PreviewAction;
  detail: string;
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  status: "active" | "inactive";
}

// ---- 한글 라벨 매핑 ----

export const SOURCE_LABEL: Record<ReservationSource, string> = {
  excel: "엑셀",
  local_collector: "수집기",
  text_inquiry: "텍스트문의",
};

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  confirmed: "확정",
  changed: "변경",
  cancelled: "취소",
};

export const SETTLEMENT_LABEL: Record<SettlementStatus, string> = {
  needs_check: "별도 확인 필요",
  completed: "확인 완료",
  not_applicable: "해당 없음",
};

export const TAX_LABEL: Record<TaxInvoiceStatus, string> = {
  needs_check: "별도 확인 필요",
  issued: "발행 완료",
  not_applicable: "해당 없음",
};

export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  pending: "대기",
  confirmed: "확정",
  rejected: "반려",
};

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  applied: "성공",
  failed: "실패",
  reverted: "되돌림",
};

export const PREVIEW_ACTION_LABEL: Record<PreviewAction, string> = {
  create: "신규",
  update: "업데이트",
  merge: "병합",
  change: "변경",
  cancel: "취소",
  skip: "변경 없음",
  error: "오류",
};
