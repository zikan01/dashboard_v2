"use client";

// 데이터 저장소 — Supabase 연동판 (기존 localStorage 방식 대체)
// 조회: 브라우저 anon 클라이언트 (RLS 적용 — 같은 사업장만)
// 쓰기: 운영상태·문의는 RLS 허용 범위에서 클라이언트가 직접,
//       예약 사실정보(업로드 반영·승격·삭제)는 서버 API(Service Role) 경유 (TRD §3.3)

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import type {
  AuditLog,
  ImportBatch,
  Inquiry,
  InquiryStatus,
  ParsedInquiry,
  Reservation,
  StaffMember,
} from "@/lib/types";
import type { ImportPlan } from "@/lib/excel";

export interface ManualPatch {
  settlementStatus?: Reservation["settlementStatus"];
  taxInvoiceStatus?: Reservation["taxInvoiceStatus"];
  memo?: string;
}

export interface PromoteInput {
  guestName: string;
  guestPhone: string;
  visitStartDate: string;
  pax: number;
  options: string[];
}

interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface PromoteResult extends ActionResult {
  displayNo?: string;
}

interface DataContextValue {
  ready: boolean;
  reservations: Reservation[];
  batches: ImportBatch[];
  auditLogs: AuditLog[];
  inquiries: Inquiry[];
  staff: StaffMember[];
  canRevert: boolean;
  applyImport: (plan: ImportPlan) => Promise<ActionResult>;
  revertLastImport: () => Promise<ActionResult>;
  updateManual: (
    id: string,
    patch: ManualPatch,
    logs: { fieldName: string; oldValue: string | null; newValue: string }[]
  ) => Promise<void>;
  promoteInquiry: (
    input: PromoteInput,
    inquiryId: string
  ) => Promise<PromoteResult>;
  deleteReservation: (id: string) => Promise<void>;
  resetAllData: () => Promise<void>;
  addInquiry: (rawText: string, parsed: ParsedInquiry) => Promise<void>;
  updateInquiryParsed: (id: string, patch: Partial<ParsedInquiry>) => Promise<void>;
  setInquiryStatus: (id: string, status: InquiryStatus) => Promise<void>;
  inviteStaff: (email: string, name: string) => Promise<ActionResult>;
  setStaffStatus: (id: string, status: "active" | "inactive") => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

// ---- DB row → 앱 타입 매핑 ----

const two = (n: number) => String(n).padStart(2, "0");

function fmtStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function mapReservation(row: any): Reservation {
  const manual = one<any>(row.reservation_manual_statuses);
  return {
    id: row.id,
    displayNo: row.display_no,
    reservationNo: row.reservation_no,
    source: row.source,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    visitStartDate: row.visit_start_date,
    visitEndDate: row.visit_end_date,
    pax: row.pax,
    channel: row.channel,
    paidAmount: row.paid_amount,
    reservationStatus: row.reservation_status,
    options: (row.reservation_options ?? []).map((o: any) => o.option_name),
    settlementStatus: manual?.settlement_status ?? "needs_check",
    taxInvoiceStatus: manual?.tax_invoice_status ?? "needs_check",
    memo: manual?.memo ?? "", // ⚠️ 항상 문자열
  };
}

function mapBatch(row: any): ImportBatch {
  return {
    id: row.id,
    executedAt: fmtStamp(row.created_at),
    executedBy: one<any>(row.profiles)?.name ?? "—",
    source: row.source,
    status: row.status,
    totalCount: row.total_count ?? 0,
    appliedCount: (row.new_count ?? 0) + (row.update_count ?? 0) + (row.cancel_count ?? 0),
    errorCount: row.error_count ?? 0,
    localFileSaved: row.local_file_saved,
  };
}

function mapAudit(row: any): AuditLog {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value ?? "",
    changedBy: one<any>(row.profiles)?.name ?? "—",
    changedAt: fmtStamp(row.changed_at).slice(5), // "MM-DD HH:mm"
  };
}

function mapInquiry(row: any): Inquiry {
  return {
    id: row.id,
    rawText: row.raw_text,
    parsed: (row.parsed ?? {}) as ParsedInquiry,
    status: row.status,
    mergeCandidateDisplayNo: null,
    createdAt: fmtStamp(row.created_at),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function postApi(path: string, body: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error ?? "요청에 실패했습니다." };
    return { ok: true, ...data };
  } catch {
    return { ok: false, message: "서버에 연결할 수 없습니다." };
  }
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);

  const fetchAll = useCallback(async () => {
    const [res, bat, aud, inq, prof] = await Promise.all([
      supabase
        .from("reservations")
        .select(
          "id, display_no, reservation_no, source, guest_name, guest_phone, visit_start_date, visit_end_date, pax, channel, paid_amount, reservation_status, reservation_options(option_name), reservation_manual_statuses(settlement_status, tax_invoice_status, memo)"
        )
        .order("visit_start_date"),
      supabase
        .from("import_batches")
        .select(
          "id, created_at, source, status, total_count, new_count, update_count, cancel_count, error_count, local_file_saved, profiles(name)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("reservation_audit_logs")
        .select(
          "id, reservation_id, field_name, old_value, new_value, changed_at, profiles(name)"
        )
        .order("changed_at", { ascending: false }),
      supabase
        .from("reservation_inquiries")
        .select("id, raw_text, parsed, status, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, name, email, role, status").order("created_at"),
    ]);
    setReservations((res.data ?? []).map(mapReservation));
    setBatches((bat.data ?? []).map(mapBatch));
    setAuditLogs((aud.data ?? []).map(mapAudit));
    setInquiries((inq.data ?? []).map(mapInquiry));
    setStaff(
      (prof.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        status: p.status,
      }))
    );
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setReservations([]);
      setBatches([]);
      setAuditLogs([]);
      setInquiries([]);
      setStaff([]);
      setReady(true);
      return;
    }
    setReady(false);
    fetchAll().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user, fetchAll]);

  // ---- 서버 API 경유 (예약 사실정보 쓰기) ----

  const applyImport = useCallback(
    async (plan: ImportPlan) => {
      const result = await postApi("/api/import", { plan });
      await fetchAll();
      return result;
    },
    [fetchAll]
  );

  const revertLastImport = useCallback(async () => {
    const result = await postApi("/api/import/revert", {});
    await fetchAll();
    return result;
  }, [fetchAll]);

  const promoteInquiry = useCallback(
    async (input: PromoteInput, inquiryId: string) => {
      const result = (await postApi("/api/inquiries/promote", {
        input,
        inquiryId,
      })) as PromoteResult;
      await fetchAll();
      return result; // 실패 사유(message)까지 화면에 전달
    },
    [fetchAll]
  );

  const deleteReservation = useCallback(
    async (id: string) => {
      await postApi("/api/reservations/delete", { id });
      await fetchAll();
    },
    [fetchAll]
  );

  const resetAllData = useCallback(async () => {
    await postApi("/api/admin/reset", {});
    await fetchAll();
  }, [fetchAll]);

  const inviteStaff = useCallback(
    async (email: string, name: string) => {
      const result = await postApi("/api/staff/invite", { email, name });
      await fetchAll();
      return result;
    },
    [fetchAll]
  );

  const setStaffStatus = useCallback(
    async (id: string, status: "active" | "inactive") => {
      await postApi("/api/staff/status", { id, status });
      await fetchAll();
    },
    [fetchAll]
  );

  // ---- 클라이언트 직접 쓰기 (RLS 허용 범위) ----

  // 운영상태(정산·세금·메모): 직원도 수정 가능 (TRD §3.3 manual_status_update)
  // 작성자 위조 방지를 위해 서버 API 경유 — updated_by/changed_by는 서버 세션에서 기록
  const updateManual = useCallback(
    async (
      id: string,
      patch: ManualPatch,
      logs: { fieldName: string; oldValue: string | null; newValue: string }[]
    ) => {
      // 낙관적 갱신 — 셀렉트/메모가 즉시 반영되도록
      setReservations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
      const result = await postApi("/api/reservations/manual", {
        reservationId: id,
        patch,
        logs,
      });
      if (!result.ok) {
        // 실패 시 서버 상태로 되돌림
        await fetchAll();
        return;
      }
      if (logs.length > 0) {
        const { data } = await supabase
          .from("reservation_audit_logs")
          .select(
            "id, reservation_id, field_name, old_value, new_value, changed_at, profiles(name)"
          )
          .order("changed_at", { ascending: false });
        setAuditLogs((data ?? []).map(mapAudit));
      }
    },
    [supabase, fetchAll]
  );

  // 문의: owner만 쓰기 가능 (RLS inquiries_write)
  const addInquiry = useCallback(
    async (rawText: string, parsed: ParsedInquiry) => {
      if (!user) return;
      await supabase.from("reservation_inquiries").insert({
        business_id: user.businessId,
        raw_text: rawText,
        parsed,
        created_by: user.id,
      });
      const { data } = await supabase
        .from("reservation_inquiries")
        .select("id, raw_text, parsed, status, created_at")
        .order("created_at", { ascending: false });
      setInquiries((data ?? []).map(mapInquiry));
    },
    [supabase, user]
  );

  const updateInquiryParsed = useCallback(
    async (id: string, patch: Partial<ParsedInquiry>) => {
      // 낙관적 갱신 (입력 타이핑이 끊기지 않도록) + 서버 반영
      let nextParsed: ParsedInquiry = {};
      setInquiries((prev) =>
        prev.map((q) => {
          if (q.id !== id) return q;
          nextParsed = { ...q.parsed, ...patch };
          return { ...q, parsed: nextParsed };
        })
      );
      await supabase
        .from("reservation_inquiries")
        .update({ parsed: nextParsed })
        .eq("id", id);
    },
    [supabase]
  );

  const setInquiryStatus = useCallback(
    async (id: string, status: InquiryStatus) => {
      setInquiries((prev) =>
        prev.map((q) => (q.id === id ? { ...q, status } : q))
      );
      await supabase.from("reservation_inquiries").update({ status }).eq("id", id);
    },
    [supabase]
  );

  const canRevert = batches.some(
    (b) => b.source === "excel" && b.status === "applied"
  );

  return (
    <DataContext.Provider
      value={{
        ready,
        reservations,
        batches,
        auditLogs,
        inquiries,
        staff,
        canRevert,
        applyImport,
        revertLastImport,
        updateManual,
        promoteInquiry,
        deleteReservation,
        resetAllData,
        addInquiry,
        updateInquiryParsed,
        setInquiryStatus,
        inviteStaff,
        setStaffStatus,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData는 DataProvider 안에서만 사용할 수 있습니다.");
  return ctx;
}
