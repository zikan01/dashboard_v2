"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { EXPORT_COLUMNS, type ExportColumnKey } from "@/lib/mock-data";
import {
  formatPreparationsForExport,
  type PreparationGroup,
} from "@/lib/preparation-match";
import { todayStr } from "@/lib/utils";
import { useData } from "@/components/data-provider";
import {
  SETTLEMENT_LABEL,
  STATUS_LABEL,
  TAX_LABEL,
  type Reservation,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

const PERIODS = ["이번 달", "다음 달", "전체 기간"] as const;
const STATUSES = ["전체 상태", "확정", "변경"] as const;

// 증분(S-A04): "준비물" 필드 — 기본 미선택이라 선택하지 않으면 기존 내보내기와 동일 (회귀 없음)
const ALL_COLUMNS = [
  ...EXPORT_COLUMNS,
  { key: "preparations", label: "준비물" },
] as const;
type ColumnKey = (typeof ALL_COLUMNS)[number]["key"];

function cellValue(r: Reservation, key: ExportColumnKey): string | number {
  switch (key) {
    case "displayNo":
      return r.displayNo;
    case "visitStartDate":
      return r.visitStartDate;
    case "guestName":
      return r.guestName;
    case "guestPhone":
      return r.guestPhone;
    case "pax":
      return r.pax;
    case "options":
      return r.options.join(", ");
    case "paidAmount":
      return r.paidAmount;
    case "reservationStatus":
      return STATUS_LABEL[r.reservationStatus];
    case "settlementStatus":
      return SETTLEMENT_LABEL[r.settlementStatus];
    case "taxInvoiceStatus":
      return TAX_LABEL[r.taxInvoiceStatus];
  }
}

// 파일명 규칙: 예약마스터_YYYYMMDD_HHmm.xlsx — 덮어쓰기 금지, 시각별 새 파일 (TRD §7.4)
function buildFileName(now: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `예약마스터_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.xlsx`;
}

export default function ExportPage() {
  const { ready, reservations } = useData();
  const [checked, setChecked] = useState<Record<ColumnKey, boolean>>(
    Object.fromEntries(
      ALL_COLUMNS.map((c, i) => [c.key, c.key !== "preparations" && i < 8])
    ) as Record<ColumnKey, boolean>
  );

  // 준비물 매칭용 목록 — 필드를 선택하지 않으면 결과에 영향 없음
  const [preparations, setPreparations] = useState<PreparationGroup[]>([]);
  const [prepsLoaded, setPrepsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/preparations")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setPreparations(data.preparations ?? []);
          setPrepsLoaded(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("이번 달");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("전체 상태");
  const [doneMessage, setDoneMessage] = useState("");

  const fileName = buildFileName(new Date());

  const targets = useMemo(() => {
    const today = todayStr();
    const thisMonth = today.slice(0, 7); // "YYYY-MM"
    const nextMonthDate = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1);
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
    return reservations.filter((r) => {
      const m = r.visitStartDate.slice(0, 7);
      if (period === "이번 달" && m !== thisMonth) return false;
      if (period === "다음 달" && m !== nextMonth) return false;
      if (status === "확정" && r.reservationStatus !== "confirmed") return false;
      if (status === "변경" && r.reservationStatus !== "changed") return false;
      return true;
    });
  }, [reservations, period, status]);

  const runExport = () => {
    if (targets.length === 0) {
      setDoneMessage("내보낼 예약이 없습니다. 기간·상태 필터를 확인해 주세요.");
      return;
    }
    const cols = ALL_COLUMNS.filter((c) => checked[c.key]);
    if (cols.length === 0) {
      setDoneMessage("내보낼 컬럼을 1개 이상 선택해 주세요.");
      return;
    }
    if (checked.preparations && !prepsLoaded) {
      setDoneMessage("준비물 목록을 아직 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const rows = targets.map((r) =>
      Object.fromEntries(
        cols.map((c) => [
          c.label,
          c.key === "preparations"
            ? // 형식: "옵션명: 항목, 항목 / 옵션명: (미등록)" (FRD §4)
              formatPreparationsForExport(r.options, preparations)
            : cellValue(r, c.key),
        ])
      )
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "예약마스터");
    const name = buildFileName(new Date());
    XLSX.writeFile(wb, name); // SheetJS 다운로드 저장 (TRD §1)
    setDoneMessage(
      `${targets.length}건을 ${name} 으로 저장했습니다. (2단계에서 Supabase 동시 반영 연결)`
    );
  };

  if (!ready) return null;

  return (
    <div>
      <div className="mb-[18px] rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
        NEW · 원하는 필드만 골라 엑셀로 내보내면서, 같은 데이터가 대시보드에도 동시에
        반영됩니다. 파일은 날짜·시각별 새 파일로 로컬에 저장됩니다.
      </div>

      <Card>
        <CardTitle>내보낼 필드 선택 (내보내기 프로필)</CardTitle>
        <div className="my-3 grid grid-cols-4 gap-2 max-[1080px]:grid-cols-2">
          {ALL_COLUMNS.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-2 text-[12.5px]"
            >
              <input
                type="checkbox"
                checked={checked[c.key]}
                onChange={() =>
                  setChecked((prev) => ({ ...prev, [c.key]: !prev[c.key] }))
                }
                className="accent-green-700"
              />
              {c.label}
            </label>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {PERIODS.map((v) => (
            <Chip key={v} on={period === v} onClick={() => setPeriod(v)}>
              {v}
            </Chip>
          ))}
          <span className="w-3" />
          {STATUSES.map((v) => (
            <Chip key={v} on={status === v} onClick={() => setStatus(v)}>
              {v}
            </Chip>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Button onClick={runExport}>엑셀 내보내기 + 대시보드 반영</Button>
          <span className="text-[12.5px] text-muted">
            대상 {targets.length}건 · 저장 예정:{" "}
            <b className="tabular-nums text-ink">{fileName}</b> (대표 PC 로컬)
          </span>
        </div>
        {doneMessage && (
          <div className="mt-3 rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
            {doneMessage}
          </div>
        )}
        <div className="mt-3 text-[11.5px] text-muted">
          * 로컬 저장과 온라인 반영은 한 묶음으로 처리되며, 하나라도 실패하면 전체를
          되돌리고 재시도를 안내합니다.
        </div>
      </Card>
    </div>
  );
}
