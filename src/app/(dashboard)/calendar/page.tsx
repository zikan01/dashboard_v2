"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { STATUS_LABEL, type ReservationStatus } from "@/lib/types";
import { cn, todayStr } from "@/lib/utils";
import { useData } from "@/components/data-provider";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 상태별 이벤트 색 (FRD §6: 확정=강조, 변경=주의, 취소=흐림+취소선)
const EV_CLASS: Record<ReservationStatus, string> = {
  confirmed: "bg-green-100 text-green-900",
  changed: "bg-amber-100 text-amber-700",
  cancelled: "bg-sand-100 text-[#9b958a] line-through",
};

export default function CalendarPage() {
  const { ready, reservations } = useData();
  const [month, setMonth] = useState(() => todayStr().slice(0, 7)); // "YYYY-MM"
  const [visible, setVisible] = useState<Record<ReservationStatus, boolean>>({
    confirmed: true,
    changed: true,
    cancelled: true,
  });

  if (!ready) return null;

  const [year, monthNum] = month.split("-").map(Number);
  const firstDow = new Date(year, monthNum - 1, 1).getDay();
  const lastDate = new Date(year, monthNum, 0).getDate();
  const today = todayStr();
  const todayDate = today.startsWith(month) ? Number(today.slice(8)) : null;

  const moveMonth = (delta: number) => {
    const d = new Date(year, monthNum - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const byDay = new Map<number, typeof reservations>();
  for (const r of reservations) {
    if (!r.visitStartDate.startsWith(month)) continue;
    const d = Number(r.visitStartDate.slice(8));
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  return (
    <div className="rounded-card border border-border bg-white p-5 shadow-card">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-y-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => moveMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-btn border border-border text-muted hover:bg-[#f5f2ea]"
            title="이전 달"
          >
            <ChevronLeft size={15} />
          </button>
          <b className="min-w-[110px] text-center text-base">
            {year}년 {monthNum}월
          </b>
          <button
            type="button"
            onClick={() => moveMonth(1)}
            className="flex h-7 w-7 items-center justify-center rounded-btn border border-border text-muted hover:bg-[#f5f2ea]"
            title="다음 달"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted">
          {(Object.keys(STATUS_LABEL) as ReservationStatus[]).map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={visible[s]}
                onChange={() => setVisible((v) => ({ ...v, [s]: !v[s] }))}
                className="accent-green-700"
              />
              <i
                className={cn(
                  "inline-block h-[9px] w-[9px] rounded-[3px]",
                  s === "confirmed" && "bg-green-100",
                  s === "changed" && "bg-amber-100",
                  s === "cancelled" && "bg-sand-100"
                )}
              />
              {STATUS_LABEL[s]}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-center text-[11.5px] text-muted">
            {w}
          </div>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`e-${i}`} />
        ))}
        {Array.from({ length: lastDate }).map((_, i) => {
          const d = i + 1;
          const events = (byDay.get(d) ?? []).filter(
            (r) => visible[r.reservationStatus]
          );
          return (
            <div
              key={d}
              className={cn(
                "min-h-[96px] rounded-[10px] border border-[#efeae0] bg-cream p-2",
                d === todayDate && "border-green-700 shadow-[inset_0_0_0_1px_#2E7D5B]"
              )}
            >
              <div className="mb-1.5 text-xs text-[#8b8578]">{d}</div>
              {events.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    "mb-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-1.5 py-[3px] text-[11px]",
                    EV_CLASS[r.reservationStatus]
                  )}
                >
                  {r.guestName} {r.pax}명
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
