"use client";

// 메시지 템플릿 (🔑 대표 전용) — 목록 + 편집 카드, 변수 칩 삽입, 실시간 바이트·유형·비용 (FRD §5)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Textarea, Select } from "@/components/ui/input";
import { eucKrByteLength, estimateCost, smsType } from "@/lib/notifications/cost";
import { renderTemplate } from "@/lib/notifications/template-renderer";
import { STAGE_LABEL, fmtKst } from "@/lib/notifications/ui-labels";
import { formatKoreanDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Tpl {
  id: string;
  name: string;
  purpose: string;
  body_text: string;
  is_active: boolean;
  updated_at: string;
}

interface FormState {
  id: string | null;
  name: string;
  purpose: string;
  body_text: string;
  is_active: boolean;
}

const emptyForm: FormState = { id: null, name: "", purpose: "d_7", body_text: "", is_active: true };

const SAMPLE_VARS = {
  고객명: "김민지",
  방문일: formatKoreanDate(new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)),
  인원: "4",
  옵션: "바베큐, 계곡 체험",
  표시번호: "GMW-260820-008",
};

const VAR_KEYS = ["고객명", "방문일", "인원", "옵션", "표시번호", "사업장전화", "사업장주소"];

const PURPOSE_OPTIONS = ["d_7", "d_3", "d_1", "d_day", "manual"];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "flex h-[22px] w-[38px] items-center rounded-full p-[2px] transition-colors",
        on ? "justify-end bg-green-700" : "justify-start bg-[#d9d3c6]"
      )}
    >
      <i className="h-[18px] w-[18px] rounded-full bg-white" />
    </button>
  );
}

export default function MessageTemplatesPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [notice, setNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (user?.role !== "owner") return;
    const db = createClient();
    const { data } = await db
      .from("message_templates")
      .select("id, name, purpose, body_text, is_active, updated_at")
      .order("purpose")
      .order("created_at");
    setTemplates(data ?? []);
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  const selectTemplate = (t: Tpl) => {
    setForm({ id: t.id, name: t.name, purpose: t.purpose, body_text: t.body_text, is_active: t.is_active });
    setNotice(""); setErrorMsg("");
  };

  const newTemplate = () => {
    setForm(emptyForm);
    setNotice(""); setErrorMsg("");
  };

  const insertVar = (key: string) => {
    const el = bodyRef.current;
    const insert = `#{${key}}`;
    const start = el?.selectionStart ?? form.body_text.length;
    const end = el?.selectionEnd ?? start;
    const next = form.body_text.slice(0, start) + insert + form.body_text.slice(end);
    setForm((f) => ({ ...f, body_text: next }));
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + insert.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const bytes = eucKrByteLength(form.body_text);
  const type = form.body_text ? smsType(form.body_text) : "SMS";
  const cost = form.body_text ? estimateCost(form.body_text) : 0;

  const preview = useMemo(() => {
    if (!form.body_text) return null;
    const { text } = renderTemplate(form.body_text, SAMPLE_VARS);
    return { text, type: smsType(text), cost: estimateCost(text) };
  }, [form.body_text]);

  const save = async () => {
    if (!form.name.trim() || !form.body_text.trim()) {
      setErrorMsg("템플릿명과 본문을 입력하세요.");
      return;
    }
    setBusy(true); setNotice(""); setErrorMsg("");
    const res = await fetch("/api/templates", {
      method: form.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.id ?? undefined,
        name: form.name,
        purpose: form.purpose,
        body_text: form.body_text,
        is_active: form.is_active,
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setErrorMsg(body.error ?? "저장에 실패했습니다."); return; }
    setNotice(form.id ? "템플릿이 수정되었습니다." : "템플릿이 생성되었습니다.");
    if (!form.id && body.id) setForm((f) => ({ ...f, id: body.id }));
    void load();
  };

  const remove = async () => {
    if (!form.id) return;
    if (!confirm(`"${form.name}" 템플릿을 삭제할까요?`)) return;
    setBusy(true); setNotice(""); setErrorMsg("");
    const res = await fetch("/api/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: form.id }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setErrorMsg(body.error ?? "삭제에 실패했습니다."); return; }
    setNotice("템플릿이 삭제되었습니다.");
    newTemplate();
    void load();
  };

  if (user?.role !== "owner") {
    return <div className="text-[13px] text-muted">대표(관리자)만 접근할 수 있는 메뉴입니다.</div>;
  }

  return (
    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(340px,1fr)] items-start gap-5 max-[1100px]:grid-cols-1">
      <div className="flex flex-col gap-4">
        {notice && <div className="rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">{notice}</div>}
        {errorMsg && <div className="rounded-[10px] border border-red-100 bg-red-50 px-3.5 py-[11px] text-[12.5px] text-red-700">{errorMsg}</div>}

        <div className="flex items-center justify-between">
          <div className="text-[12.5px] text-muted">템플릿을 선택하면 오른쪽에서 편집할 수 있습니다.</div>
          <Button onClick={newTemplate}>+ 새 템플릿</Button>
        </div>

        <div className="rounded-card border border-border bg-white px-3.5 py-1.5 shadow-card">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["템플릿명", "단계", "예상 유형", "활성", "수정일"].map((h) => (
                  <th key={h} className="border-b border-border bg-[#faf7f0] px-2.5 py-3 text-left text-[11.5px] font-semibold text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className={cn("cursor-pointer", form.id === t.id ? "bg-[#faf7f0]" : "hover:bg-[#fbf9f4]")}
                >
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] font-bold">{t.name}</td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    <Badge variant="gray">{STAGE_LABEL[t.purpose] ?? t.purpose}</Badge>
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    <Badge variant="green">{smsType(t.body_text)}</Badge>
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                    {t.is_active ? <Badge variant="green">활성</Badge> : <Badge variant="gray">비활성</Badge>}
                  </td>
                  <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[12.5px] text-muted">{fmtKst(t.updated_at)}</td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2.5 py-8 text-center text-[13px] text-muted">
                    등록된 템플릿이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Card>
        <CardTitle>{form.id ? "템플릿 수정" : "새 템플릿"}</CardTitle>

        <div className="mt-3 grid grid-cols-2 gap-3 max-[600px]:grid-cols-1">
          <div>
            <label className="mb-1 block text-[11.5px] text-muted">템플릿명</label>
            <Input value={form.name} placeholder="예: D-7 안내"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-muted">발송 단계</label>
            <Select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
              {PURPOSE_OPTIONS.map((p) => (
                <option key={p} value={p}>{STAGE_LABEL[p]}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-[11.5px] text-muted">본문</label>
          <Textarea
            ref={bodyRef}
            className="min-h-[180px]"
            value={form.body_text}
            placeholder="#{고객명}님, #{방문일} 방문을 안내드립니다."
            onChange={(e) => setForm({ ...form, body_text: e.target.value })}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {VAR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => insertVar(key)}
                className="rounded-btn border border-border bg-white px-2.5 py-[5px] text-[11.5px] text-[#55514a] hover:bg-[#f5f2ea]"
              >
                #{`{${key}}`}
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-[12px]">
            <span className="text-muted">{bytes}바이트</span>
            <Badge variant="green">{type}</Badge>
            <span className="text-muted">건당 약 {cost}원 (VAT 별도)</span>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-[11.5px] text-muted">미리보기 · 예시 고객 정보로 치환</div>
          {preview ? (
            <div className="whitespace-pre-line rounded-[4px_16px_16px_16px] bg-[#EDF1F4] px-4 py-3.5 text-[12.5px] leading-[1.7] text-ink">
              {preview.text}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted">본문을 입력하면 미리보기가 표시됩니다.</div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">활성</span>
            <Toggle on={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
          <div className="flex items-center gap-2">
            {form.id && (
              <button type="button" onClick={remove} disabled={busy}
                className="rounded-btn border border-red-100 bg-red-50 px-3 py-[7px] text-[12.5px] text-red-700 hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50">
                삭제
              </button>
            )}
            <Button onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
