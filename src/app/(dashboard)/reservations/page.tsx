"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useData } from "@/components/data-provider";
import {
  SETTLEMENT_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  TAX_LABEL,
  type ReservationSource,
  type ReservationStatus,
  type SettlementStatus,
} from "@/lib/types";
import { formatShortDate, formatWon, maskPhone } from "@/lib/utils";
import {
  Badge,
  reservationStatusVariant,
  settlementVariant,
  taxVariant,
} from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";

const STATUS_FILTERS: { label: string; value: ReservationStatus | "all" }[] = [
  { label: "전체", value: "all" },
  { label: "확정", value: "confirmed" },
  { label: "변경", value: "changed" },
  { label: "취소", value: "cancelled" },
];

const SETTLEMENT_FILTERS: { label: string; value: SettlementStatus | "all" }[] = [
  { label: "정산 전체", value: "all" },
  { label: "확인 필요", value: "needs_check" },
  { label: "확인 완료", value: "completed" },
];

const SOURCE_FILTERS: { label: string; value: ReservationSource | "all" }[] = [
  { label: "출처 전체", value: "all" },
  { label: "엑셀", value: "excel" },
  { label: "수집기", value: "local_collector" },
  { label: "텍스트문의", value: "text_inquiry" },
];

export default function ReservationListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { ready, reservations, deleteReservation, resetAllData } = useData();
  const [status, setStatus] = useState<ReservationStatus | "all">("all");
  const [settlement, setSettlement] = useState<SettlementStatus | "all">("all");
  const [source, setSource] = useState<ReservationSource | "all">("all");
  const [query, setQuery] = useState("");
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null); // 행 삭제 2단계 확인
  const [armedReset, setArmedReset] = useState(false); // 전체 초기화 2단계 확인
  const isOwner = user?.role === "owner";

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...reservations].sort((a, b) =>
      a.visitStartDate < b.visitStartDate ? -1 : 1
    );
    return sorted.filter((r) => {
      if (status !== "all" && r.reservationStatus !== status) return false;
      if (settlement !== "all" && r.settlementStatus !== settlement) return false;
      if (source !== "all" && r.source !== source) return false;
      if (!q) return true;
      // 검색: 예약자명 · 연락처 뒷자리 · 표시번호 · 네이버 예약번호 (FRD §4)
      return (
        r.guestName.toLowerCase().includes(q) ||
        r.guestPhone.replace(/-/g, "").includes(q.replace(/-/g, "")) ||
        r.displayNo.toLowerCase().includes(q) ||
        (r.reservationNo ?? "").includes(q)
      );
    });
  }, [reservations, status, settlement, source, query]);

  if (!ready) return null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <Chip key={f.value} on={status === f.value} onClick={() => setStatus(f.value)}>
            {f.label}
          </Chip>
        ))}
        <span className="w-2" />
        {SETTLEMENT_FILTERS.map((f) => (
          <Chip
            key={f.value}
            on={settlement === f.value}
            onClick={() => setSettlement(f.value)}
          >
            {f.label}
          </Chip>
        ))}
        <span className="w-2" />
        {SOURCE_FILTERS.map((f) => (
          <Chip key={f.value} on={source === f.value} onClick={() => setSource(f.value)}>
            {f.label}
          </Chip>
        ))}
        <input
          className="ml-auto w-[230px] rounded-btn border border-border bg-white px-3 py-2 text-[12.5px] outline-none placeholder:text-faint focus:border-green-700"
          placeholder="예약자명 · 연락처 · 표시번호 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* 🔑 대표 전용: 전체 데이터 초기화 (2단계 확인) */}
      {isOwner && reservations.length > 0 && (
        <div className="mb-3 flex items-center justify-end gap-2">
          {armedReset ? (
            <>
              <span className="text-[12px] text-[#a2453c]">
                예약·업로드 이력·수정 이력·문의가 모두 삭제됩니다. 되돌릴 수 없습니다.
              </span>
              <button
                type="button"
                onClick={() => {
                  resetAllData();
                  setArmedReset(false);
                }}
                className="rounded-btn border border-[#c0392b] bg-[#c0392b] px-3 py-[7px] text-[12.5px] font-semibold text-white hover:bg-[#a93226]"
              >
                정말 전체 삭제
              </button>
              <button
                type="button"
                onClick={() => setArmedReset(false)}
                className="rounded-btn border border-border bg-white px-3 py-[7px] text-[12.5px] text-[#55514a] hover:bg-[#f5f2ea]"
              >
                취소
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setArmedReset(true)}
              className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-white px-3 py-[7px] text-[12.5px] text-[#a2453c] hover:bg-[#f9ecea]"
            >
              <Trash2 size={13} />
              전체 데이터 초기화
            </button>
          )}
        </div>
      )}

      <div className="rounded-card border border-border bg-white px-3.5 py-1.5 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  "방문일",
                  "표시번호",
                  "예약자",
                  "연락처",
                  "인원",
                  "옵션",
                  "결제금액",
                  "출처",
                  "상태",
                  "정산",
                  "세금계산서",
                  ...(isOwner ? [""] : []),
                ].map((h, i) => (
                  <th
                    key={i}
                    className={`border-b border-border bg-[#faf7f0] px-2.5 py-3 text-left text-[11.5px] font-semibold text-muted ${h === "결제금액" ? "text-right" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/reservations/${r.id}`)}
                  className="cursor-pointer hover:bg-[#faf8f2]"
                >
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]">
                    {formatShortDate(r.visitStartDate)}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-xs tabular-nums text-[#6f6a5f]">
                    {r.displayNo}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] font-bold">
                    {r.guestName}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-xs tabular-nums text-[#6f6a5f]">
                    {maskPhone(r.guestPhone)}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]">
                    {r.pax}명
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]">
                    {r.options.join(", ")}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-right text-[13px] font-bold">
                    {formatWon(r.paidAmount)}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-xs text-[#6f6a5f]">
                    {SOURCE_LABEL[r.source]}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    <Badge variant={reservationStatusVariant[r.reservationStatus]}>
                      {STATUS_LABEL[r.reservationStatus]}
                    </Badge>
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    <Badge variant={settlementVariant[r.settlementStatus]}>
                      {SETTLEMENT_LABEL[r.settlementStatus]}
                    </Badge>
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    <Badge variant={taxVariant[r.taxInvoiceStatus]}>
                      {TAX_LABEL[r.taxInvoiceStatus]}
                    </Badge>
                  </td>
                  {isOwner && (
                    <td
                      className="border-b border-[#f2eee5] px-2.5 py-[13px] text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {armedDeleteId === r.id ? (
                        <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              deleteReservation(r.id);
                              setArmedDeleteId(null);
                            }}
                            className="rounded-btn bg-[#c0392b] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#a93226]"
                          >
                            삭제 확인
                          </button>
                          <button
                            type="button"
                            onClick={() => setArmedDeleteId(null)}
                            className="rounded-btn border border-border bg-white px-2.5 py-1 text-[11.5px] text-[#55514a] hover:bg-[#f5f2ea]"
                          >
                            취소
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          title="예약 삭제 (대표 전용)"
                          onClick={() => setArmedDeleteId(r.id)}
                          className="rounded-btn p-1.5 text-muted hover:bg-[#f9ecea] hover:text-[#a2453c]"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={isOwner ? 12 : 11}
                    className="px-2.5 py-8 text-center text-[13px] text-muted"
                  >
                    조건에 맞는 예약이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 text-[11.5px] text-muted">
        총 {rows.length}건 · 목록 연락처는 개인정보 보호를 위해 마스킹됩니다. 행을
        클릭하면 상세로 이동합니다.
      </div>
    </div>
  );
}
