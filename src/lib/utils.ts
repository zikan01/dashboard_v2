import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Reservation } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatWon = (n: number) => "₩" + n.toLocaleString("ko-KR");

// 목록에서는 연락처 마스킹: 010-1234-5678 → 010-****-5678
export const maskPhone = (p: string) =>
  p.replace(/(\d{3})-(\d{3,4})-(\d{4})/, "$1-****-$3");

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

const toDate = (d: string) => new Date(d + "T00:00:00");

// "2026-07-09" → "7/9 (목)"
export function formatShortDate(d: string) {
  const dt = toDate(d);
  return `${dt.getMonth() + 1}/${dt.getDate()} (${DOW[dt.getDay()]})`;
}

// "2026-07-09" → "2026년 7월 9일 (목)"
export function formatKoreanDate(d: string) {
  const dt = toDate(d);
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DOW[dt.getDay()]})`;
}

// "2026-07-09" → "7월 9일 (목)"
export function formatMonthDay(d: string) {
  const dt = toDate(d);
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DOW[dt.getDay()]})`;
}

// today 기준 남은 일수 (오늘=0, 내일=1)
export function daysUntil(today: string, date: string) {
  return Math.round((toDate(date).getTime() - toDate(today).getTime()) / 86400000);
}

// 오늘 날짜 "YYYY-MM-DD" (로컬 기준) — 클라이언트에서만 호출
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 현재 시각 "YYYY-MM-DD HH:mm"
export function nowStamp() {
  const d = new Date();
  return `${todayStr()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// KPI 계산 — "이번 달 예약 = 취소 제외(확정+변경)" (FRD §3)
export function calcKpis(reservations: Reservation[], today: string) {
  const month = today.slice(0, 7);
  const inMonth = reservations.filter((r) => r.visitStartDate.startsWith(month));
  const active = inMonth.filter((r) => r.reservationStatus !== "cancelled");
  return {
    monthCount: active.length,
    totalPax: active.reduce((a, r) => a + r.pax, 0),
    expectedRevenue: active.reduce((a, r) => a + r.paidAmount, 0),
    upcomingCount: reservations.filter(
      (r) => r.reservationStatus !== "cancelled" && r.visitStartDate > today
    ).length,
    exceptionCount: inMonth.filter((r) => r.reservationStatus !== "confirmed").length,
  };
}
