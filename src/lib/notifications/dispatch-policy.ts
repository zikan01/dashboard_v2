// 발송 직전 재검증(TRD §15)과 발송 모드 게이트(TRD §22) — 순수 함수
import { isValidMobile, normalizePhone } from "./phone";
import type { DispatchDecision, JobRow, ReservationSnapshot, SendMode, SkipReason } from "./types";

export function revalidateJob(
  job: JobRow,
  reservation: ReservationSnapshot,
  notificationEnabled: boolean,
  sameStageAlreadySucceeded: boolean
): SkipReason | null {
  if (reservation.reservation_status === "cancelled") return "reservation_cancelled";
  if (job.base_visit_date !== null && job.base_visit_date !== reservation.visit_start_date)
    return "visit_date_changed";
  if (!notificationEnabled) return "notification_disabled";
  if (!isValidMobile(reservation.guest_phone)) return "invalid_phone";
  if (sameStageAlreadySucceeded) return "already_succeeded";
  return null;
}

export function decideDispatch(
  mode: SendMode,
  phone: string,
  allowlist: string[]
): DispatchDecision {
  if (mode === "dry_run") return { action: "dry_run" };
  if (mode === "allowlist") {
    const normalized = normalizePhone(phone);
    return allowlist.map(normalizePhone).includes(normalized)
      ? { action: "send" }
      : { action: "blocked_by_allowlist" };
  }
  return { action: "send" };
}
