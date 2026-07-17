"use client";

// 발송 일정 (FRD §8) — 오늘/이번 주/전체 예정/취소·제외 탭 + 대표 행 액션(즉시 발송·제외·시각 변경)
// 직원도 조회 가능 — 행 액션 버튼만 숨긴다 (접근 자체는 차단하지 않음).

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { estimateCost } from "@/lib/notifications/cost";
import type { DispatchSummary } from "@/lib/notifications/dispatcher";
import { JOB_STATUS_LABEL, JOB_STATUS_VARIANT, STAGE_LABEL, fmtKst } from "@/lib/notifications/ui-labels";
import { formatShortDate } from "@/lib/utils";

interface JobRow {
  id: string;
  stage: string;
  status: string;
  scheduled_at: string;
  reservations: { guest_name: string; display_no: string; visit_start_date: string } | null;
  notification_rules: { message_templates: { body_text: string } | null } | null;
}

type TabKey = "today" | "week" | "upcoming" | "cancelled";

const TABS: { key: TabKey; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "week", label: "이번 주" },
  { key: "upcoming", label: "전체 예정" },
  { key: "cancelled", label: "취소·제외" },
];

const UPCOMING_STATUSES = ["scheduled", "processing"];
const CANCELLED_STATUSES = [
  "skipped",
  "cancelled_by_change",
  "cancelled_by_reservation",
  "cancelled_by_admin",
];

// KST(UTC+9)는 서머타임이 없어 고정 오프셋으로 계산한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstDateStr = (iso: string) =>
  new Date(new Date(iso).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

// datetime-local input의 기본값(로컬 벽시계 기준) — 적용 시 new Date(v).toISOString()으로 역변환한다.
function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NotificationSchedulePage() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<TabKey>("today");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");
  const [notice, setNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [costUnit, setCostUnit] = useState<{ smsCost?: number; lmsCost?: number }>({});

  const load = useCallback(async () => {
    const db = createClient();
    const [{ data }, { data: settings }] = await Promise.all([
      db
        .from("notification_jobs")
        .select(
          "id, stage, status, scheduled_at, reservations(guest_name, display_no, visit_start_date), notification_rules(message_templates(body_text))"
        )
        .in("status", [...UPCOMING_STATUSES, ...CANCELLED_STATUSES])
        .order("scheduled_at"),
      db.from("business_notification_settings").select("sms_unit_cost, lms_unit_cost").maybeSingle(),
    ]);
    setJobs((data as unknown as JobRow[] | null) ?? []);
    setCostUnit({
      smsCost: settings?.sms_unit_cost != null ? Number(settings.sms_unit_cost) : undefined,
      lmsCost: settings?.lms_unit_cost != null ? Number(settings.lms_unit_cost) : undefined,
    });
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const todayStr = kstDateStr(new Date().toISOString());
  const { weekStartStr, weekEndStr } = useMemo(() => {
    // 이번 주 = 월요일~일요일 (KST) — inquiry-parser.ts의 "이번 주" 계산 관례와 동일
    const now = new Date(Date.now() + KST_OFFSET_MS);
    const dow = (now.getUTCDay() + 6) % 7; // 월=0 ... 일=6
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - dow);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
      weekStartStr: monday.toISOString().slice(0, 10),
      weekEndStr: sunday.toISOString().slice(0, 10),
    };
  }, []);

  const filtered = useMemo(() => {
    if (tab === "upcoming") return jobs.filter((j) => UPCOMING_STATUSES.includes(j.status));
    if (tab === "cancelled") return jobs.filter((j) => CANCELLED_STATUSES.includes(j.status));
    if (tab === "today")
      return jobs.filter((j) => UPCOMING_STATUSES.includes(j.status) && kstDateStr(j.scheduled_at) === todayStr);
    return jobs.filter((j) => {
      const d = kstDateStr(j.scheduled_at);
      return UPCOMING_STATUSES.includes(j.status) && d >= weekStartStr && d <= weekEndStr;
    });
  }, [jobs, tab, todayStr, weekStartStr, weekEndStr]);

  const costFor = (job: JobRow) => {
    const body = job.notification_rules?.message_templates?.body_text;
    return body ? `약 ${estimateCost(body, costUnit)}원` : "—";
  };

  const runAction = useCallback(
    async (jobId: string, action: "send_now" | "exclude" | "reschedule", scheduledAt?: string) => {
      setBusyId(jobId);
      setNotice("");
      setErrorMsg("");
      const res = await fetch("/api/notifications/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action, scheduledAt }),
      });
      const body = await res.json();
      setBusyId(null);
      if (!res.ok) {
        setErrorMsg(body.error ?? "처리에 실패했습니다.");
        return;
      }
      if (action === "send_now") {
        const d = body.dispatched as DispatchSummary | null;
        setNotice(
          d
            ? `발송 처리를 실행했습니다 — 성공 ${d.sent}건 · 드라이런 ${d.dryRun}건 · 제외 ${d.skipped}건 · 실패 ${d.failed}건`
            : "발송 요청을 처리했습니다."
        );
      } else if (action === "exclude") {
        setNotice("해당 발송을 제외 처리했습니다.");
      } else {
        setNotice("발송 시각을 변경했습니다.");
      }
      setExpandedId(null);
      void load();
    },
    [load]
  );

  const sendNow = (jobId: string) => {
    if (!window.confirm("이 예약을 지금 바로 발송할까요?")) return;
    void runAction(jobId, "send_now");
  };
  const exclude = (jobId: string) => {
    if (!window.confirm("이 발송을 제외할까요? 제외된 발송은 자동으로 다시 실행되지 않습니다.")) return;
    void runAction(jobId, "exclude");
  };
  const openReschedule = (job: JobRow) => {
    setNotice("");
    setErrorMsg("");
    setExpandedId((cur) => (cur === job.id ? null : job.id));
    setRescheduleValue(toDatetimeLocalValue(job.scheduled_at));
  };
  const applyReschedule = (jobId: string) => {
    if (!rescheduleValue) return;
    void runAction(jobId, "reschedule", new Date(rescheduleValue).toISOString());
  };

  if (!loaded) return <div className="text-[13px] text-muted">불러오는 중…</div>;

  const columnCount = 7 + (isOwner ? 1 : 0);

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

      <div className="mb-3.5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Chip key={t.key} on={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </Chip>
        ))}
      </div>

      {tab === "cancelled" && (
        <div className="mb-3.5 text-[11.5px] text-muted">
          취소된 일정은 예약 정보가 변경되면 자동으로 재생성됩니다.
        </div>
      )}

      <div className="rounded-card border border-border bg-white px-3.5 py-1.5 shadow-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                "예정 시각",
                "고객",
                "표시번호",
                "방문일",
                "단계",
                "상태",
                "예상 비용",
                ...(isOwner ? [""] : []),
              ].map((h, i) => (
                <th
                  key={i}
                  className="border-b border-border bg-[#faf7f0] px-2.5 py-3 text-left text-[11.5px] font-semibold text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((job) => (
              <Fragment key={job.id}>
                <tr>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] tabular-nums">
                    {fmtKst(job.scheduled_at)}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] font-bold">
                    {job.reservations?.guest_name ?? "—"}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-xs tabular-nums text-[#6f6a5f]">
                    {job.reservations?.display_no ?? "—"}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]">
                    {job.reservations?.visit_start_date
                      ? formatShortDate(job.reservations.visit_start_date)
                      : "—"}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    <Badge variant="gray">{STAGE_LABEL[job.stage] ?? job.stage}</Badge>
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    <Badge variant={JOB_STATUS_VARIANT[job.status] ?? "gray"}>
                      {JOB_STATUS_LABEL[job.status] ?? job.status}
                    </Badge>
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] tabular-nums">
                    {costFor(job)}
                  </td>
                  {isOwner && (
                    <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-right">
                      {job.status === "scheduled" ? (
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() => sendNow(job.id)}
                            className="rounded-btn border border-border bg-white px-2.5 py-[6px] text-[12px] text-[#55514a] hover:bg-[#f5f2ea] disabled:opacity-50"
                          >
                            지금 발송
                          </button>
                          <button
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() => openReschedule(job)}
                            className="rounded-btn border border-border bg-white px-2.5 py-[6px] text-[12px] text-[#55514a] hover:bg-[#f5f2ea] disabled:opacity-50"
                          >
                            시각 변경
                          </button>
                          <button
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() => exclude(job.id)}
                            className="rounded-btn border border-border bg-white px-2.5 py-[6px] text-[12px] text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            제외
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11.5px] text-faint">—</span>
                      )}
                    </td>
                  )}
                </tr>
                {isOwner && expandedId === job.id && (
                  <tr>
                    <td colSpan={columnCount} className="border-b border-[#f2eee5] bg-[#faf7f0] px-2.5 py-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-[12.5px] text-muted">새 발송 시각</span>
                        <Input
                          type="datetime-local"
                          className="w-[220px]"
                          value={rescheduleValue}
                          onChange={(e) => setRescheduleValue(e.target.value)}
                        />
                        <Button
                          size="sm"
                          disabled={busyId === job.id}
                          onClick={() => applyReschedule(job.id)}
                        >
                          적용
                        </Button>
                        <button
                          type="button"
                          onClick={() => setExpandedId(null)}
                          className="text-[12px] text-muted hover:underline"
                        >
                          취소
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-2.5 py-8 text-center text-[13px] text-muted">
                  표시할 발송 일정이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11.5px] text-faint">
        대표는 시각 변경·즉시 발송·일회성 제외를 할 수 있고, 직원은 조회만 가능합니다.
      </div>
    </div>
  );
}
