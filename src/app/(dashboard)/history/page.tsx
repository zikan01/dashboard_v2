"use client";

import { BATCH_STATUS_LABEL } from "@/lib/types";
import { useData } from "@/components/data-provider";
import { Badge, batchStatusVariant } from "@/components/ui/badge";

const SOURCE_METHOD_LABEL = {
  excel: "엑셀 업로드",
  local_collector: "로컬 수집기",
  text_inquiry: "텍스트 문의",
} as const;

export default function HistoryPage() {
  const { ready, batches } = useData();
  if (!ready) return null;

  return (
    <div>
      <div className="rounded-card border border-border bg-white px-3.5 py-1.5 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["실행 시각", "실행자", "방식", "상태", "전체", "반영", "오류", "로컬 저장"].map(
                  (h) => (
                    <th
                      key={h}
                      className="border-b border-border bg-[#faf7f0] px-2.5 py-3 text-left text-[11.5px] font-semibold text-muted"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-xs tabular-nums text-[#6f6a5f]">
                    {b.executedAt}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] font-bold">
                    {b.executedBy}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]">
                    {SOURCE_METHOD_LABEL[b.source]}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    <Badge variant={batchStatusVariant[b.status]}>
                      {BATCH_STATUS_LABEL[b.status]}
                    </Badge>
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]">
                    {b.totalCount}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] font-bold text-green-700">
                    {b.appliedCount}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]">
                    {b.errorCount}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    {b.localFileSaved === null ? (
                      <span className="text-[13px] text-muted">—</span>
                    ) : b.localFileSaved ? (
                      <Badge variant="green">성공</Badge>
                    ) : (
                      <Badge variant="amber">실패</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2.5 py-8 text-center text-[13px] text-muted">
                    아직 업로드·수집 이력이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 text-[11.5px] text-muted">
        업로드·수집·문의 처리 이력입니다. 되돌리기는 마지막 반영 1건만 지원합니다.
      </div>
    </div>
  );
}
