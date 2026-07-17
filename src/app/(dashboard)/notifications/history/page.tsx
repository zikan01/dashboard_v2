"use client";

// 발송 이력 (FRD §9) — 조회 전용. 상태 필터 칩 + 카드 목록 + "자세히" 확장.
// 직원도 조회 가능 — 액션 버튼 없음(재발송은 실패 관리 화면에서 처리).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import {
  DELIVERY_STATUS_LABEL,
  JOB_STATUS_LABEL,
  JOB_STATUS_VARIANT,
  STAGE_LABEL,
  fmtKst,
} from "@/lib/notifications/ui-labels";

interface ContentSnapshot {
  text?: string;
  template_version?: number;
  sms_type?: string;
  missing_vars?: string[];
}
interface DeliveryRow {
  status: string;
  provider_message_id: string | null;
  provider_message_type: string | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  sent_at: string | null;
  delivered_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  content_snapshot: ContentSnapshot | null;
}
interface JobRow {
  id: string;
  stage: string;
  status: string;
  updated_at: string;
  reservations: { guest_name: string; display_no: string } | null;
  notification_deliveries: DeliveryRow[];
}

type FilterKey = "all" | "success" | "failed" | "excluded";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "success", label: "성공" },
  { key: "failed", label: "실패" },
  { key: "excluded", label: "제외" },
];

// "제외" 필터는 자동 제외(skipped)와 관리자 취소(cancelled_by_admin)를 함께 묶는다.
const FILTER_STATUSES: Record<FilterKey, string[] | null> = {
  all: null,
  success: ["success"],
  failed: ["failed"],
  excluded: ["skipped", "cancelled_by_admin"],
};

const HISTORY_STATUSES = ["success", "failed", "skipped", "cancelled_by_admin"];

export default function NotificationHistoryPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = createClient();
    const { data } = await db
      .from("notification_jobs")
      .select(
        "id, stage, status, updated_at, reservations(guest_name, display_no), notification_deliveries(status, provider_message_id, provider_message_type, estimated_cost, actual_cost, sent_at, delivered_at, last_error_code, last_error_message, content_snapshot)"
      )
      .in("status", HISTORY_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(100);
    setJobs((data as unknown as JobRow[] | null) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const statuses = FILTER_STATUSES[filter];
    if (!statuses) return jobs;
    return jobs.filter((j) => statuses.includes(j.status));
  }, [jobs, filter]);

  if (!loaded) return <div className="text-[13px] text-muted">불러오는 중…</div>;

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Chip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {filtered.map((job) => {
          const deliveries = job.notification_deliveries ?? [];
          const primary = deliveries[deliveries.length - 1] ?? null;
          const cost = primary?.actual_cost ?? primary?.estimated_cost ?? null;
          return (
            <Card key={job.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <b className="text-[13.5px]">
                    {STAGE_LABEL[job.stage] ?? job.stage} 안내 · {job.reservations?.guest_name ?? "—"}
                  </b>
                  <span className="text-[11.5px] text-faint">{job.reservations?.display_no ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                  <Badge variant={JOB_STATUS_VARIANT[job.status] ?? "gray"}>
                    {JOB_STATUS_LABEL[job.status] ?? job.status}
                  </Badge>
                  <span className="text-muted">{fmtKst(job.updated_at)}</span>
                  <span className="tabular-nums text-muted">
                    비용 {cost != null ? `${cost}원` : "—"}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {deliveries.length === 0 && (
                  <div className="text-[12.5px] text-faint">발송 기록이 없습니다.</div>
                )}
                {deliveries.map((d, idx) => {
                  const key = `${job.id}:${idx}`;
                  const snapshot = d.content_snapshot;
                  const msgType = d.provider_message_type ?? snapshot?.sms_type ?? "—";
                  const expanded = expandedKey === key;
                  return (
                    <div
                      key={key}
                      className="rounded-[10px] border border-[#f2eee5] bg-[#faf7f0] px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[12.5px]">
                          <span>문자 ({msgType})</span>
                          <Badge variant="gray">{DELIVERY_STATUS_LABEL[d.status] ?? d.status}</Badge>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedKey(expanded ? null : key)}
                          className="text-[12px] font-semibold text-green-700 hover:underline"
                        >
                          {expanded ? "접기 ←" : "자세히 →"}
                        </button>
                      </div>
                      {d.status === "failed" && d.last_error_code && (
                        <div className="mt-1.5 text-[11.5px] text-red-700">
                          {d.last_error_code}: {d.last_error_message ?? "알 수 없는 오류"}
                        </div>
                      )}
                      {expanded && (
                        <div className="mt-2.5 border-t border-[#eee6d6] pt-2.5 text-[12.5px]">
                          <div className="whitespace-pre-line rounded-[4px_16px_16px_16px] bg-white px-3.5 py-3 leading-[1.6] text-ink">
                            {snapshot?.text ?? "—"}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                            <span>외부 메시지 ID · {d.provider_message_id ?? "—"}</span>
                            <span>발송 · {fmtKst(d.sent_at)}</span>
                            <span>수신 · {fmtKst(d.delivered_at)}</span>
                          </div>
                          {!!snapshot?.missing_vars?.length && (
                            <div className="mt-1.5 text-[11.5px] text-red-700">
                              ⚠ 치환되지 않은 변수: {snapshot.missing_vars.join(", ")}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <div className="rounded-card border border-border bg-white px-3.5 py-8 text-center text-[13px] text-muted shadow-card">
            표시할 발송 이력이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
