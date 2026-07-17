"use client";

// 자동 안내 설정 (🔑 대표 전용) — 전체 스위치 + D-7·D-3·D-1·당일 규칙 (FRD §4)

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { estimateCost, smsType } from "@/lib/notifications/cost";
import { renderTemplate } from "@/lib/notifications/template-renderer";
import { STAGE_LABEL } from "@/lib/notifications/ui-labels";
import { formatKoreanDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Tpl { id: string; name: string; body_text: string; purpose: string; is_active: boolean }
interface Rule { stage: string; enabled: boolean; send_time: string; sms_template_id: string | null }
interface Settings {
  notification_enabled: boolean;
  sender_phone: string | null;
  business_phone: string | null;
  business_address: string | null;
  sms_unit_cost: number;
  lms_unit_cost: number;
}

const SAMPLE_VARS = {
  고객명: "김민지",
  방문일: formatKoreanDate(new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)),
  인원: "4",
  옵션: "바베큐, 계곡 체험",
  표시번호: "GMW-260820-008",
};

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

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [previewStage, setPreviewStage] = useState("d_7");
  const [notice, setNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const db = createClient();
    const [{ data: s }, { data: r }, { data: t }] = await Promise.all([
      db.from("business_notification_settings").select("*").maybeSingle(),
      db.from("notification_rules").select("stage, enabled, send_time, sms_template_id").order("offset_days", { ascending: false }),
      db.from("message_templates").select("id, name, body_text, purpose, is_active").eq("is_active", true).order("created_at"),
    ]);
    setSettings(s ?? null);
    setRules(r ?? []);
    setTemplates(t ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setRule = (stage: string, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r) => (r.stage === stage ? { ...r, ...patch } : r)));

  const previewRule = rules.find((r) => r.stage === previewStage);
  const previewTpl = templates.find((t) => t.id === previewRule?.sms_template_id);
  const preview = useMemo(() => {
    if (!previewTpl) return null;
    const { text } = renderTemplate(previewTpl.body_text, {
      ...SAMPLE_VARS,
      사업장전화: settings?.business_phone ?? "",
      사업장주소: settings?.business_address ?? "",
    });
    return {
      text,
      type: smsType(text),
      cost: estimateCost(text, {
        smsCost: Number(settings?.sms_unit_cost ?? 18),
        lmsCost: Number(settings?.lms_unit_cost ?? 45),
      }),
    };
  }, [previewTpl, settings]);

  const save = async () => {
    if (!settings) return;
    setBusy(true); setNotice(""); setErrorMsg("");
    const res = await fetch("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          notification_enabled: settings.notification_enabled,
          sender_phone: settings.sender_phone,
          business_phone: settings.business_phone,
          business_address: settings.business_address,
        },
        rules: rules.map((r) => ({
          stage: r.stage, enabled: r.enabled,
          send_time: r.send_time, sms_template_id: r.sms_template_id,
        })),
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setErrorMsg(body.error ?? "저장에 실패했습니다."); return; }
    setNotice("저장되었습니다. 변경된 규칙은 이후 새로 생성되는 발송 일정부터 적용됩니다.");
    void load();
  };

  if (user?.role !== "owner") {
    return <div className="text-[13px] text-muted">대표(관리자)만 접근할 수 있는 메뉴입니다.</div>;
  }
  if (!settings) return <div className="text-[13px] text-muted">불러오는 중…</div>;

  return (
    <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)] items-start gap-5 max-[1100px]:grid-cols-1">
      <div className="flex flex-col gap-4">
        {notice && <div className="rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">{notice}</div>}
        {errorMsg && <div className="rounded-[10px] border border-red-100 bg-red-50 px-3.5 py-[11px] text-[12.5px] text-red-700">{errorMsg}</div>}

        <Card>
          <CardTitle>전체 설정</CardTitle>
          <div className="mt-3 flex items-center justify-between">
            <div>
              <b className="text-[13.5px]">자동 안내 전체 활성화</b>
              <div className="text-[11.5px] text-muted">끄면 새 발송 일정이 생성되지 않고 예정 발송도 중단됩니다.</div>
            </div>
            <Toggle on={settings.notification_enabled}
              onChange={(v) => setSettings({ ...settings, notification_enabled: v })} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
            {([
              ["발신번호 (SOLAPI 등록 번호)", "sender_phone", "010-0000-0000"],
              ["사업장 전화 (#{사업장전화})", "business_phone", "031-000-0000"],
            ] as const).map(([label, key, ph]) => (
              <div key={key}>
                <label className="mb-1 block text-[11.5px] text-muted">{label}</label>
                <Input value={settings[key] ?? ""} placeholder={ph}
                  onChange={(e) => setSettings({ ...settings, [key]: e.target.value || null })} />
              </div>
            ))}
            <div className="col-span-2 max-[700px]:col-span-1">
              <label className="mb-1 block text-[11.5px] text-muted">사업장 주소 (#{"{사업장주소}"})</label>
              <Input value={settings.business_address ?? ""} placeholder="경기도 ..."
                onChange={(e) => setSettings({ ...settings, business_address: e.target.value || null })} />
            </div>
          </div>
          <div className="mt-3 text-[11px] text-faint">기준 시간대 · Asia/Seoul</div>
        </Card>

        {rules.map((r) => (
          <Card key={r.stage}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Badge variant={r.enabled ? "green" : "gray"}>{STAGE_LABEL[r.stage]}</Badge>
                <Input type="time" className="w-[110px]" value={r.send_time.slice(0, 5)}
                  onChange={(e) => setRule(r.stage, { send_time: e.target.value })} />
              </div>
              <Toggle on={r.enabled} onChange={(v) => setRule(r.stage, { enabled: v })} />
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-[11.5px] text-muted">문자 템플릿</label>
              <select
                className="w-full rounded-btn border border-border bg-white px-2.5 py-[7px] text-[12.5px]"
                value={r.sms_template_id ?? ""}
                onChange={(e) => setRule(r.stage, { sms_template_id: e.target.value || null })}
              >
                <option value="">— 템플릿 선택 —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {r.enabled && !r.sms_template_id && (
                <div className="mt-1.5 text-[11.5px] text-red-700">⚠ 템플릿이 없으면 저장 시 활성화가 거부됩니다.</div>
              )}
            </div>
            <button type="button" className="mt-2.5 text-[12px] font-semibold text-green-700 hover:underline"
              onClick={() => setPreviewStage(r.stage)}>
              미리보기 →
            </button>
          </Card>
        ))}

        <Button onClick={save} disabled={busy}>{busy ? "저장 중…" : "설정 저장"}</Button>
      </div>

      <Card>
        <CardTitle>실시간 미리보기 · 문자 (SMS·LMS)</CardTitle>
        <div className="mt-1 text-[11.5px] text-muted">{STAGE_LABEL[previewStage]} 단계 · 예시 고객 정보로 치환</div>
        {preview ? (
          <>
            <div className="mt-3 whitespace-pre-line rounded-[4px_16px_16px_16px] bg-[#EDF1F4] px-4 py-3.5 text-[12.5px] leading-[1.7] text-ink">
              {preview.text}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[12px]">
              <Badge variant="green">{preview.type}</Badge>
              <span className="text-muted">건당 약 {preview.cost}원 (VAT 별도)</span>
            </div>
          </>
        ) : (
          <div className="mt-3 text-[12.5px] text-muted">이 단계에 템플릿이 지정되지 않았습니다.</div>
        )}
        <div className="mt-3 text-[11px] text-faint">변수는 발송 직전 실제 고객 정보로 치환됩니다.</div>
      </Card>
    </div>
  );
}
