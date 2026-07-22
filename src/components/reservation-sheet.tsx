"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ArrowUpRight } from "lucide-react";
import {
  SETTLEMENT_LABEL,
  STATUS_LABEL,
  TAX_LABEL,
  type Reservation,
} from "@/lib/types";
import { cn, formatKoreanDate, formatWon } from "@/lib/utils";
import {
  Badge,
  reservationStatusVariant,
  settlementVariant,
  taxVariant,
} from "@/components/ui/badge";

type SheetContext = { open: (r: Reservation) => void };

const Ctx = createContext<SheetContext | null>(null);

/** 캘린더 등에서 예약 요약 슬라이드를 열 때 사용. */
export function useReservationSheet() {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "useReservationSheet는 ReservationSheetProvider 안에서만 사용할 수 있습니다."
    );
  return ctx;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#efeae0] py-2.5 last:border-b-0">
      <span className="shrink-0 text-[12.5px] text-muted">{label}</span>
      <span className="text-right text-[13.5px] font-medium">{children}</span>
    </div>
  );
}

/**
 * 예약 요약 시트.
 * - 데스크톱(sm 이상): 화면 오른쪽에서 밀려 나오는 슬라이드 패널.
 * - 모바일(sm 미만): 아래에서 올라오는 바텀시트.
 */
export function ReservationSheetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [current, setCurrent] = useState<Reservation | null>(null);
  const [visible, setVisible] = useState(false); // 진입/퇴장 애니메이션용
  const pathname = usePathname();

  const open = useCallback((r: Reservation) => setCurrent(r), []);

  const close = useCallback(() => {
    setVisible(false);
    const t = setTimeout(() => setCurrent(null), 220); // 트랜지션 후 언마운트
    return () => clearTimeout(t);
  }, []);

  // 진입 애니메이션: 마운트 직후 visible 전환
  useEffect(() => {
    if (!current) return;
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [current]);

  // 본문 스크롤 잠금 + ESC 닫기
  useEffect(() => {
    if (!current) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [current, close]);

  // 페이지 이동 시 닫힘 (상세 보기 링크 포함)
  useEffect(() => {
    setVisible(false);
    setCurrent(null);
  }, [pathname]);

  const r = current;

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {r && (
        <div className="fixed inset-0 z-[60]">
          {/* 오버레이 */}
          <div
            onClick={close}
            aria-hidden
            className={cn(
              "absolute inset-0 bg-black/40 transition-opacity duration-200",
              visible ? "opacity-100" : "opacity-0"
            )}
          />
          {/* 패널: 모바일=바텀시트, sm 이상=우측 드로어 */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="예약 요약"
            className={cn(
              "absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-cream shadow-2xl transition-transform duration-200 ease-out",
              "sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0",
              visible
                ? "translate-y-0 sm:translate-x-0"
                : "translate-y-full sm:translate-y-0 sm:translate-x-full"
            )}
          >
            {/* 헤더 */}
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <div className="text-[18px] font-bold">
                  {r.guestName}
                  <span className="ml-1.5 text-[13px] font-medium text-muted">
                    {r.pax}명
                  </span>
                </div>
                <div className="mt-0.5 text-[11.5px] tabular-nums text-faint">
                  {r.displayNo}
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="닫기"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn text-muted hover:bg-[#f0ece2] hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            {/* 본문 요약 */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <div className="mb-3 flex flex-wrap gap-1.5">
                <Badge variant={reservationStatusVariant[r.reservationStatus]}>
                  예약 {STATUS_LABEL[r.reservationStatus]}
                </Badge>
                <Badge variant={settlementVariant[r.settlementStatus]}>
                  정산 {SETTLEMENT_LABEL[r.settlementStatus]}
                </Badge>
                <Badge variant={taxVariant[r.taxInvoiceStatus]}>
                  세금계산서 {TAX_LABEL[r.taxInvoiceStatus]}
                </Badge>
              </div>

              <Field label="방문일">{formatKoreanDate(r.visitStartDate)}</Field>
              <Field label="인원">{r.pax}명</Field>
              <Field label="옵션">
                {r.options.length > 0 ? r.options.join(", ") : "옵션 없음"}
              </Field>
              <Field label="연락처">
                <span className="tabular-nums">{r.guestPhone}</span>
              </Field>
              <Field label="채널">{r.channel ?? "직접 문의"}</Field>
              <Field label="결제금액">
                <span className="font-bold tabular-nums">
                  {formatWon(r.paidAmount)}
                </span>
              </Field>
            </div>

            {/* 하단 액션 */}
            <div className="border-t border-border px-5 py-3.5">
              <Link
                href={`/reservations/${r.id}`}
                onClick={close}
                className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-green-700 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-green-800"
              >
                전체 상세 보기
                <ArrowUpRight size={15} />
              </Link>
              <p className="mt-2 text-center text-[11px] text-faint">
                연락처는 개인정보 보호를 위해 마스킹되어 표시됩니다.
              </p>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
