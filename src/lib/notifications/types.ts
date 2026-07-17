// 발송 엔진 내부 타입 — DB 행(snake_case)을 그대로 다룬다 (서버 전용)

export interface JobRow {
  id: string;
  business_id: string;
  reservation_id: string;
  rule_id: string | null;
  stage: "d_7" | "d_3" | "d_1" | "d_day" | "manual";
  base_visit_date: string | null;
  scheduled_at: string;
  status: string;
  attempt_count: number;
}

export interface ReservationSnapshot {
  id: string;
  guest_name: string;
  guest_phone: string;
  visit_start_date: string;
  reservation_status: "confirmed" | "changed" | "cancelled";
}

export type SendMode = "dry_run" | "allowlist" | "live";

export type SkipReason =
  | "reservation_cancelled"
  | "visit_date_changed"
  | "notification_disabled"
  | "invalid_phone"
  | "already_succeeded";

export type DispatchDecision =
  | { action: "skip"; reason: SkipReason }
  | { action: "dry_run" }
  | { action: "blocked_by_allowlist" }
  | { action: "send" };
