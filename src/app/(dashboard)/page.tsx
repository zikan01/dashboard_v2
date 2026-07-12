"use client";

import Link from "next/link";
import { FolderOpen } from "lucide-react";
import {
  Bar,
  BarChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  SETTLEMENT_LABEL,
  STATUS_LABEL,
  TAX_LABEL,
  type Reservation,
} from "@/lib/types";
import {
  cn,
  daysUntil,
  formatWon,
  todayStr,
} from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { useData } from "@/components/data-provider";
import {
  Badge,
  reservationStatusVariant,
  settlementVariant,
  taxVariant,
} from "@/components/ui/badge";
import { Card, CardCaption, CardTitle } from "@/components/ui/card";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 옵션 → 필요 식자재·준비물 요약 (일자별 식사 준비 표시용)
const OPTION_INGREDIENTS: Record<string, string[]> = {
  바베큐: ["고기", "숯", "채소"],
  계곡: ["물놀이용품"],
  버스왕복: ["차량 배차"],
  매실: ["매실", "설탕"],
  숙박: ["침구", "수건"],
};

// 월별 채널 매출 색 (dataviz 검증 통과: 온라인 #25904F · 오프라인 #C4661F)
const CHANNEL_COLORS = { 온라인: "#25904F", 오프라인: "#C4661F" } as const;

// "김다희" + 2명 → "김다희 외 1"
const guestLabel = (r: Reservation) =>
  r.pax > 1 ? `${r.guestName} 외 ${r.pax - 1}` : r.guestName;

const ingredientsOf = (r: Reservation) => {
  const items = r.options.flatMap((o) => OPTION_INGREDIENTS[o] ?? [o]);
  return items.length > 0 ? [...new Set(items)].join("·") : "—";
};

// 채널 구분: 네이버 등 유입 채널이 있으면 온라인, 텍스트 문의 등은 오프라인
const channelType = (r: Reservation) => (r.channel ? "온라인" : "오프라인");

const manWon = (n: number) => `${Math.round(n / 10000)}만`;

const thClass =
  "bg-[#f7f4ec] px-3 py-2 text-left text-[11.5px] font-semibold text-muted first:rounded-l-lg last:rounded-r-lg";
const tdClass = "border-b border-[#f0ece2] px-3 py-2.5 text-[12.5px]";

export default function HomePage() {
  const { ready, reservations } = useData();
  const { user } = useAuth();
  if (!ready) return null;

  const today = todayStr();
  const [year, monthNum] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const month = today.slice(0, 7); // "YYYY-MM"

  const active = reservations.filter((r) => r.reservationStatus !== "cancelled");
  const monthActive = active
    .filter((r) => r.visitStartDate.startsWith(month))
    .sort((a, b) => (a.visitStartDate < b.visitStartDate ? -1 : 1));
  const upcoming = active
    .filter((r) => r.visitStartDate >= today)
    .sort((a, b) => (a.visitStartDate < b.visitStartDate ? -1 : 1));

  const kpiCards = [
    { label: `${monthNum}월 확정 예약`, value: `${monthActive.length}건` },
    {
      label: "총 방문 인원",
      value: `${monthActive.reduce((a, r) => a + r.pax, 0)}명`,
    },
    {
      label: `${monthNum}월 확정 매출`,
      value: formatWon(monthActive.reduce((a, r) => a + r.paidAmount, 0)),
    },
    {
      label: "세금계산서 미발행",
      value: `${monthActive.filter((r) => r.taxInvoiceStatus === "needs_check").length}건`,
      alert: true,
    },
    {
      label: "정산 대기",
      value: `${monthActive.filter((r) => r.settlementStatus === "needs_check").length}건`,
      alert: true,
    },
  ];

  // 캘린더 (이번 달 고정 — 월 이동은 예약 캘린더 페이지에서)
  const firstDow = new Date(year, monthNum - 1, 1).getDay();
  const lastDate = new Date(year, monthNum, 0).getDate();
  const todayDate = Number(today.slice(8));
  const byDay = new Map<number, Reservation[]>();
  for (const r of reservations) {
    if (!r.visitStartDate.startsWith(month)) continue;
    const d = Number(r.visitStartDate.slice(8));
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  // 월별 채널 매출 (취소 제외 전체 기간)
  const byMonth = new Map<string, { 온라인: number; 오프라인: number }>();
  for (const r of active) {
    const m = r.visitStartDate.slice(0, 7);
    const row = byMonth.get(m) ?? { 온라인: 0, 오프라인: 0 };
    row[channelType(r)] += r.paidAmount;
    byMonth.set(m, row);
  }
  const chartData = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([m, v]) => ({ month: `${Number(m.slice(5))}월`, ...v }));

  return (
    <div>
      {/* 헤더 배너 */}
      <div className="mb-3 flex items-center justify-between rounded-card bg-green-900 px-6 py-5 text-white">
        <div>
          <h2 className="text-[19px] font-bold tracking-tight">
            고마워할매 — 경영 정보 대시보드
          </h2>
          <div className="mt-1 text-[12.5px] text-white/70">
            예약 + 매출 통합 현황 · 기준월 {year}년 {monthNum}월
          </div>
        </div>
        <span className="rounded-full bg-white/15 px-3.5 py-1.5 text-[12.5px] font-semibold">
          오늘 {monthNum}월 {todayDate}일
        </span>
      </div>

      {/* 데이터 기준 안내 */}
      <div className="mb-3 rounded-[10px] border border-[#eadfc6] bg-[#fdf6e9] px-4 py-2.5 text-center text-[12.5px] text-[#7a6234]">
        ✓ 네이버 스마트플레이스 <b>예약관리(상세)</b> 실데이터 기준 · 확정 예약{" "}
        {monthActive.length}건 반영 (정산·증빙·세금계산서 항목은 원본 데이터
        미포함으로 &lsquo;대기&rsquo; 표기)
      </div>

      {/* 엑셀 업로드 스트립 (관리자 전용) */}
      {user?.role === "owner" && (
        <div className="mb-5 flex flex-wrap items-center gap-3.5 rounded-card border-[1.5px] border-dashed border-[#cfc7b4] bg-cream px-5 py-4">
          <FolderOpen size={18} className="text-amber-700" />
          <b className="text-[13.5px]">엑셀 업로드</b>
          <span className="text-[12.5px] text-muted">
            네이버 스마트플레이스에서 내려받은 <b>예약관리(상세)</b> .xlsx 파일을
            올리면 대시보드가 자동 갱신됩니다.
          </span>
          <Link
            href="/upload"
            className="ml-auto rounded-btn bg-green-700 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-green-800"
          >
            파일 선택
          </Link>
        </div>
      )}

      {/* KPI 5종 */}
      <div className="mb-[22px] grid grid-cols-5 gap-4 max-[1080px]:grid-cols-2">
        {kpiCards.map((k) => (
          <Card key={k.label} className="px-[18px] pb-4 pt-[18px]">
            <div className="mb-2.5 text-xs text-muted">{k.label}</div>
            <div
              className={cn(
                "text-[26px] font-bold tracking-tight",
                k.alert && k.value !== "0건" && "text-[#c0392b]"
              )}
            >
              {k.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-[1.55fr_1fr] gap-5 max-[1080px]:grid-cols-1">
        {/* 예약 캘린더 */}
        <Card>
          <CardTitle>
            <span className="inline-block h-[14px] w-[5px] rounded-sm bg-green-700" />
            예약 캘린더 ( {year}년 {monthNum}월 )
          </CardTitle>
          <div className="mt-3.5 grid grid-cols-7 gap-1.5">
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
              return (
                <div
                  key={d}
                  className={cn(
                    "min-h-[62px] rounded-lg border border-[#efeae0] bg-cream p-1.5",
                    d === todayDate &&
                      "border-green-700 shadow-[inset_0_0_0_1px_#2E7D5B]"
                  )}
                >
                  <div className="mb-1 text-[11px] text-[#8b8578]">{d}</div>
                  {(byDay.get(d) ?? []).map((r) => (
                    <div
                      key={r.id}
                      className={cn(
                        "mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap rounded px-1 py-[2px] text-[10.5px]",
                        r.reservationStatus === "confirmed" &&
                          "bg-green-100 text-green-900",
                        r.reservationStatus === "changed" &&
                          "bg-amber-100 text-amber-700",
                        r.reservationStatus === "cancelled" &&
                          "bg-sand-100 text-[#9b958a] line-through"
                      )}
                    >
                      {r.guestName} {r.pax}인
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-4 text-[11.5px] text-muted">
            {(
              [
                ["확정", "bg-green-100"],
                ["일정변경", "bg-amber-100"],
                ["취소", "bg-sand-100"],
              ] as const
            ).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5">
                <i className={cn("inline-block h-[9px] w-[9px] rounded-[3px]", color)} />
                {label}
              </span>
            ))}
          </div>
        </Card>

        {/* 다가오는 준비 알림 */}
        <Card>
          <CardTitle>
            <span className="inline-block h-[14px] w-[5px] rounded-sm bg-amber-700" />
            다가오는 준비 알림
          </CardTitle>
          <div className="mt-3.5">
            {upcoming.length === 0 && (
              <div className="py-3 text-[13px] text-muted">
                다가오는 예약이 없습니다.
              </div>
            )}
            {upcoming.slice(0, 6).map((r) => {
              const d = daysUntil(today, r.visitStartDate);
              return (
                <div
                  key={r.id}
                  className="flex gap-3 border-b border-dashed border-[#efeae0] py-3 first:pt-1 last:border-b-0"
                >
                  <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] bg-green-800 text-white">
                    <span className="text-[9px] leading-none opacity-80">D-</span>
                    <span className="text-[15px] font-bold leading-tight">
                      {d}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px]">
                      <b>{guestLabel(r)}</b>
                      <span className="text-muted">
                        {" "}
                        · {r.pax}인 · {r.visitStartDate.slice(5).replace("-", "-")}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted">
                      {r.options.join("·") || "옵션 없음"}
                    </div>
                    <Badge
                      variant={reservationStatusVariant[r.reservationStatus]}
                      className="mt-1.5"
                    >
                      예약 {STATUS_LABEL[r.reservationStatus]}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* 일자별 식사 준비·식자재 */}
      <Card className="mb-5">
        <CardTitle>
          <span className="inline-block h-[14px] w-[5px] rounded-sm bg-green-700" />
          일자별 식사 준비 · 식자재
        </CardTitle>
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["방문일", "예약자", "식사 수량", "필요 식자재", "상태"].map((h) => (
                  <th key={h} className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr>
                  <td colSpan={5} className={cn(tdClass, "text-muted")}>
                    준비할 예약이 없습니다.
                  </td>
                </tr>
              )}
              {upcoming.map((r) => (
                <tr key={r.id}>
                  <td className={cn(tdClass, "tabular-nums")}>
                    {r.visitStartDate.slice(5)}
                  </td>
                  <td className={cn(tdClass, "font-semibold")}>{guestLabel(r)}</td>
                  <td className={tdClass}>{r.pax}인분</td>
                  <td className={tdClass}>{ingredientsOf(r)}</td>
                  <td className={tdClass}>
                    <Badge variant={reservationStatusVariant[r.reservationStatus]}>
                      {STATUS_LABEL[r.reservationStatus]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 월별 채널 매출 */}
      <Card className="mb-5">
        <CardTitle>
          <span className="inline-block h-[14px] w-[5px] rounded-sm bg-amber-700" />
          월별 채널 매출
        </CardTitle>
        <CardCaption>취소 제외 결제금액 합계</CardCaption>
        {chartData.length === 0 ? (
          <div className="py-3 text-[13px] text-muted">
            아직 매출 데이터가 없습니다.
          </div>
        ) : (
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11.5, fill: "#8A8577" }}
                />
                <YAxis hide />
                <Tooltip
                  formatter={(v: number) => formatWon(v)}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid #E7E2D6",
                    fontSize: 12,
                  }}
                />
                <Legend
                  iconType="square"
                  iconSize={9}
                  wrapperStyle={{ fontSize: 11.5, color: "#8A8577" }}
                />
                {(["온라인", "오프라인"] as const).map((key) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={CHANNEL_COLORS[key]}
                    barSize={26}
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey={key}
                      position="top"
                      formatter={manWon}
                      style={{ fontSize: 10.5, fill: "#8A8577" }}
                    />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* 매출 상세 · 정산 / 세금계산서 */}
      <Card>
        <CardTitle>
          <span className="inline-block h-[14px] w-[5px] rounded-sm bg-amber-700" />
          매출 상세 · 정산 / 세금계산서
        </CardTitle>
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["방문일", "예약자", "채널", "구분", "금액", "정산", "세금계산서", "상태"].map(
                  (h) => (
                    <th key={h} className={thClass}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {monthActive.length === 0 && (
                <tr>
                  <td colSpan={8} className={cn(tdClass, "text-muted")}>
                    이번 달 매출 내역이 없습니다.
                  </td>
                </tr>
              )}
              {monthActive.map((r) => (
                <tr key={r.id}>
                  <td className={cn(tdClass, "tabular-nums")}>
                    {r.visitStartDate.slice(5)}
                  </td>
                  <td className={cn(tdClass, "font-semibold")}>{guestLabel(r)}</td>
                  <td className={tdClass}>{r.channel ?? "직접 문의"}</td>
                  <td className={tdClass}>{channelType(r)}</td>
                  <td className={cn(tdClass, "font-bold tabular-nums")}>
                    {formatWon(r.paidAmount)}
                  </td>
                  <td className={tdClass}>
                    <Badge variant={settlementVariant[r.settlementStatus]}>
                      {SETTLEMENT_LABEL[r.settlementStatus]}
                    </Badge>
                  </td>
                  <td className={tdClass}>
                    <Badge variant={taxVariant[r.taxInvoiceStatus]}>
                      {TAX_LABEL[r.taxInvoiceStatus]}
                    </Badge>
                  </td>
                  <td className={tdClass}>
                    <Badge variant={reservationStatusVariant[r.reservationStatus]}>
                      {STATUS_LABEL[r.reservationStatus]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[11.5px] text-muted">
          취소 예약은 매출·준비 집계에서 제외됩니다.
        </div>
      </Card>
    </div>
  );
}
