"use client";

// 실패 관리 (FRD §10) — 실패 카드 + 마스킹 번호 경고 + 대표 액션(재발송·제외·처리 완료)
// 직원도 조회 가능 — 액션 버튼만 owner 한정(접근 자체는 차단하지 않음).

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import type { DispatchSummary } from "@/lib/notifications/dispatcher";
import { STAGE_LABEL, fmtKst } from "@/lib/notifications/ui-labels";

interface DeliveryRow {
  sequence_no: number;
  last_error_code: string | null;
  last_error_message: string | null;
  failed_at: string | null;
}
interface JobRow {
  id: string;
  stage: string;
  updated_at: string;
  cancellation_reason: string | null;
  reservations: { guest_name: string; display_no: string; guest_phone: string } | null;
  notification_deliveries: DeliveryRow[];
}

export default function NotificationFailuresPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = createClient();
    const { data } = await db
      .from("notification_jobs")
      .select(
        "id, stage, updated_at, cancellation_reason, reservations(guest_name, display_no, guest_phone), notification_deliveries(sequence_no, last_error_code, last_error_message, failed_at)"
      )
      .eq("status", "failed")
      .order("updated_at", { ascending: false });
    setJobs((data as unknown as JobRow[] | null) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (jobId: string, action: "retry" | "exclude", successNotice: string) => {
      setBusyId(jobId);
      setNotice("");
      setErrorMsg("");
      const res = await fetch("/api/notifications/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      const body = await res.json();
      setBusyId(null);
      if (!res.ok) {
        setErrorMsg(body.error ?? "처리에 실패했습니다.");
        return;
      }
      if (action === "retry") {
        const d = body.dispatched as DispatchSummary | null;
        setNotice(
          d
            ? `재발송을 실행했습니다 — 성공 ${d.sent}건 · 드라이런 ${d.dryRun}건 · 제외 ${d.skipped}건 · 실패 ${d.failed}건`
            : successNotice
        );
      } else {
        setNotice(successNotice);
      }
      void load();
    },
    [load]
  );

  const retry = (jobId: string) => {
    if (!window.confirm("이 건을 다시 발송할까요?")) return;
    void runAction(jobId, "retry", "재발송을 요청했습니다.");
  };
  const exclude = (jobId: string) => {
    if (!window.confirm("이 발송을 제외할까요? 제외된 발송은 자동으로 다시 실행되지 않습니다.")) return;
    void runAction(jobId, "exclude", "발송 제외로 처리했습니다.");
  };
  const markDone = (jobId: string) => {
    if (!window.confirm("이 실패 건을 처리 완료로 표시할까요?")) return;
    void runAction(jobId, "exclude", "처리 완료로 표시했습니다.");
  };

  if (!loaded) return <div className="text-[13px] text-muted">불러오는 중…</div>;

  return (
    <div>
      {notice && (
        <div className="mb-4 rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
          {notice}
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 rounded-[10px] border border-red-100 bg-red-50 px-3.5 py-[11px] text-[12.5px] text-red-700">
          {errorMsg}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="rounded-card border border-border bg-white px-3.5 py-8 text-center text-[13px] text-muted shadow-card">
          확인이 필요한 실패 건이 없습니다 🎉
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => {
            const deliveries = job.notification_deliveries ?? [];
            const primary = deliveries.length
              ? deliveries.reduce((a, b) => (b.sequence_no > a.sequence_no ? b : a))
              : null;
            const reason =
              job.cancellation_reason ??
              (primary?.last_error_code
                ? `${primary.last_error_code}: ${primary.last_error_message ?? "알 수 없는 오류"}`
                : "사유 미상");
            const phone = job.reservations?.guest_phone ?? "";
            const masked = phone.includes("*");
            return (
              <Card key={job.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-red-100 px-2.5 py-[3px] text-[11px] font-semibold text-red-700">
                      ✕ 최종 실패
                    </span>
                    <b className="text-[13.5px]">{job.reservations?.guest_name ?? "—"}</b>
                    <span className="text-[11.5px] text-faint">
                      {job.reservations?.display_no ?? "—"}
                    </span>
                    <span className="text-[11.5px] text-muted">
                      {STAGE_LABEL[job.stage] ?? job.stage} · 문자
                    </span>
                  </div>
                  <span className="text-[11.5px] text-muted">{fmtKst(job.updated_at)}</span>
                </div>

                <div className="mt-2 text-[12.5px] text-red-700">{reason}</div>

                {masked && (
                  <div className="mt-2.5 rounded-[10px] border border-amber-100 bg-amber-50 px-3.5 py-[11px] text-[12.5px] text-amber-700">
                    마스킹된 번호입니다 — 예약 상세에서 연락처를 수정한 뒤 재발송하세요.
                  </div>
                )}

                {isOwner && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === job.id}
                      onClick={() => retry(job.id)}
                      className="rounded-btn border border-border bg-white px-2.5 py-[6px] text-[12px] text-[#55514a] hover:bg-[#f5f2ea] disabled:opacity-50"
                    >
                      재발송
                    </button>
                    <button
                      type="button"
                      disabled={busyId === job.id}
                      onClick={() => exclude(job.id)}
                      className="rounded-btn border border-border bg-white px-2.5 py-[6px] text-[12px] text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      발송 제외
                    </button>
                    <button
                      type="button"
                      disabled={busyId === job.id}
                      onClick={() => markDone(job.id)}
                      className="rounded-btn border border-border bg-white px-2.5 py-[6px] text-[12px] text-[#55514a] hover:bg-[#f5f2ea] disabled:opacity-50"
                    >
                      처리 완료
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
