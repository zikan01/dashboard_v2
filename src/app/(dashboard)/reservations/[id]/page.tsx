"use client";

import { useState } from "react";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  SETTLEMENT_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  TAX_LABEL,
  type Reservation,
  type SettlementStatus,
  type TaxInvoiceStatus,
} from "@/lib/types";
import { formatShortDate, formatWon } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { useData } from "@/components/data-provider";
import { PreparationCard } from "@/components/preparation-card";
import { Badge, reservationStatusVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardCaption, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";

export default function ReservationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { ready, reservations } = useData();
  if (!ready) return null;
  const reservation = reservations.find((r) => r.id === params.id);
  if (!reservation) notFound();
  return <DetailView r={reservation} />;
}

function DetailView({ r }: { r: Reservation }) {
  const router = useRouter();
  const { user } = useAuth(); // 삭제 카드 노출 조건(owner)에 사용
  const { auditLogs, updateManual, deleteReservation } = useData();
  const [memo, setMemo] = useState<string>(r.memo); // ⚠️ 메모는 항상 문자열
  const [savedNote, setSavedNote] = useState("");
  const [armedDelete, setArmedDelete] = useState(false); // 삭제 2단계 확인

  const logs = auditLogs.filter((l) => l.reservationId === r.id);

  return (
    <div>
      <Link
        href="/reservations"
        className="mb-3.5 inline-block text-[13px] text-muted hover:text-ink"
      >
        ‹ 예약 목록으로
      </Link>
      <div className="grid grid-cols-[1.3fr_1fr] gap-5 max-[1080px]:grid-cols-1">
        <div>
          <Card className="mb-5">
            <CardTitle className="text-[19px]">
              {r.guestName}{" "}
              <Badge variant={reservationStatusVariant[r.reservationStatus]}>
                {STATUS_LABEL[r.reservationStatus]}
              </Badge>
            </CardTitle>
            <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-4">
              {[
                {
                  k: "표시번호 (자체 PK)",
                  v: (
                    <span className="tabular-nums text-green-700">{r.displayNo}</span>
                  ),
                },
                {
                  k: "네이버 예약번호",
                  v: (
                    <span className="tabular-nums">
                      {r.reservationNo ?? "— (텍스트 문의)"}
                    </span>
                  ),
                },
                { k: "연락처", v: r.guestPhone }, // 상세는 전체 연락처 표시 (FRD §5)
                {
                  k: "방문일",
                  v:
                    formatShortDate(r.visitStartDate) +
                    (r.visitEndDate ? ` ~ ${formatShortDate(r.visitEndDate)}` : ""),
                },
                { k: "방문 인원", v: `${r.pax}명` },
                { k: "결제금액", v: formatWon(r.paidAmount) },
                {
                  k: "출처 · 유입경로",
                  v: `${SOURCE_LABEL[r.source]} · ${r.channel ?? "—"}`,
                },
                { k: "옵션", v: r.options.join(", ") || "—" },
              ].map((f) => (
                <div key={f.k}>
                  <div className="text-[11.5px] text-muted">{f.k}</div>
                  <div className="mt-0.5 text-sm font-semibold">{f.v}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* 목업 고정 예시 표를 실데이터 매칭 카드로 대체 (A-001/A-003) — 삽입은 이 1줄 */}
          <PreparationCard options={r.options} className="mb-5" />

          <Card>
            <CardTitle>메모</CardTitle>
            <Textarea
              className="mt-2"
              placeholder="메모를 입력하세요"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
            <div className="mt-2.5 flex items-center gap-3">
              <Button
                size="sm"
                onClick={async () => {
                  await updateManual(r.id, { memo }, [
                    { fieldName: "메모", oldValue: r.memo, newValue: memo },
                  ]);
                  setSavedNote("메모가 저장되었습니다. (문자열로 저장)");
                }}
              >
                메모 저장
              </Button>
              {savedNote && (
                <span className="text-[12px] text-green-700">{savedNote}</span>
              )}
            </div>
            <div className="mt-3 text-[11.5px] text-muted">
              ✓ v2 수정: 메모는 문자열 텍스트로 저장·표시 (기존 [object Object] 버그
              해소)
            </div>
          </Card>
        </div>

        <div>
          <Card className="mb-5">
            <CardTitle>정산 · 세금계산서</CardTitle>
            <CardCaption>상태를 눌러 직접 변경할 수 있어요. (직원도 수정 가능)</CardCaption>
            <div className="text-[11.5px] text-muted">정산 상태</div>
            <Select
              className="mt-1.5"
              value={r.settlementStatus}
              onChange={(e) => {
                const next = e.target.value as SettlementStatus;
                updateManual(r.id, { settlementStatus: next }, [
                  {
                    fieldName: "정산 상태",
                    oldValue: SETTLEMENT_LABEL[r.settlementStatus],
                    newValue: SETTLEMENT_LABEL[next],
                  },
                ]);
              }}
            >
              {(Object.keys(SETTLEMENT_LABEL) as SettlementStatus[]).map((s) => (
                <option key={s} value={s}>
                  {SETTLEMENT_LABEL[s]}
                </option>
              ))}
            </Select>
            <div className="mt-3.5 text-[11.5px] text-muted">세금계산서 상태</div>
            <Select
              className="mt-1.5"
              value={r.taxInvoiceStatus}
              onChange={(e) => {
                const next = e.target.value as TaxInvoiceStatus;
                updateManual(r.id, { taxInvoiceStatus: next }, [
                  {
                    fieldName: "세금계산서 상태",
                    oldValue: TAX_LABEL[r.taxInvoiceStatus],
                    newValue: TAX_LABEL[next],
                  },
                ]);
              }}
            >
              {(Object.keys(TAX_LABEL) as TaxInvoiceStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TAX_LABEL[s]}
                </option>
              ))}
            </Select>
            <div className="mt-4 rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
              이 필드는 운영 상태 원본입니다. 엑셀 재업로드로 덮어쓰지 않습니다.
            </div>
          </Card>

          {/* 🔑 대표 전용: 예약 삭제 (2단계 확인) */}
          {user?.role === "owner" && (
            <Card className="mb-5">
              <CardTitle>예약 삭제</CardTitle>
              <CardCaption>
                이 예약과 수정 이력이 함께 삭제됩니다. 되돌릴 수 없습니다. (대표 전용)
              </CardCaption>
              {armedDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      // 삭제 후 스토어 갱신으로 이 화면이 사라지므로 먼저 목록으로 이동
                      router.replace("/reservations");
                      void deleteReservation(r.id);
                    }}
                    className="rounded-btn bg-[#c0392b] px-4 py-[9px] text-[13px] font-semibold text-white hover:bg-[#a93226]"
                  >
                    정말 삭제
                  </button>
                  <Button variant="ghost" onClick={() => setArmedDelete(false)}>
                    취소
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setArmedDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-white px-4 py-[9px] text-[13px] font-semibold text-[#a2453c] hover:bg-[#f9ecea]"
                >
                  <Trash2 size={14} />
                  이 예약 삭제
                </button>
              )}
            </Card>
          )}

          <Card>
            <CardTitle>수정 이력</CardTitle>
            <div className="mt-1">
              {logs.length === 0 && (
                <div className="py-2 text-[12.5px] text-muted">수정 이력이 없습니다.</div>
              )}
              {logs.map((l) => (
                <div
                  key={l.id}
                  className="flex gap-2.5 border-b border-[#f2eee5] py-[9px] last:border-b-0"
                >
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-700" />
                  <div>
                    <div className="text-[12.5px] font-semibold">
                      {l.fieldName} →{" "}
                      {l.newValue.length > 24
                        ? l.newValue.slice(0, 24) + "…"
                        : l.newValue || "삭제"}
                    </div>
                    <div className="text-[11.5px] text-muted">
                      {l.changedBy} · {l.changedAt}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
