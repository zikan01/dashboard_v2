// 발송 시스템 화면 공통 라벨·배지 매핑 (FRD v3.1 §11)
import type { BadgeProps } from "@/components/ui/badge";

export const STAGE_LABEL: Record<string, string> = {
  d_7: "D-7", d_3: "D-3", d_1: "D-1", d_day: "당일", manual: "수동",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  scheduled: "발송 예정",
  processing: "발송 중",
  success: "성공",
  failed: "실패",
  skipped: "제외됨",
  cancelled_by_change: "예약 변경 취소",
  cancelled_by_reservation: "예약 취소",
  cancelled_by_admin: "관리자 취소",
};

export const JOB_STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  scheduled: "amber",
  processing: "amber",
  success: "green",
  failed: "gray",
  skipped: "gray",
  cancelled_by_change: "gray",
  cancelled_by_reservation: "gray",
  cancelled_by_admin: "gray",
};

export const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "대기", queued: "대기열", sending: "발송 중", sent: "발송 완료",
  delivered: "수신 완료", failed: "실패", skipped: "제외", cancelled: "취소",
};

export const fmtKst = (ts: string | null | undefined) =>
  ts
    ? new Date(ts).toLocaleString("ko-KR", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "—";
