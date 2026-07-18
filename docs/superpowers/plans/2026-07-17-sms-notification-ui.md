# 문자 발송 관리자 UI 구현 계획 (Plan 2/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FRD v3.1의 6개 화면(자동 안내 설정·메시지 템플릿·SOLAPI 설정·발송 일정·발송 이력·실패 관리)과 그 쓰기 API를 기존 대시보드 관례에 맞춰 구현한다.

**Architecture:** 페이지는 `"use client"` 컴포넌트로 Supabase anon 클라이언트에서 직접 조회(RLS로 같은 사업장 한정, 0007 정책 적용 완료). 모든 쓰기는 owner 전용 API 라우트(Service Role)를 경유한다 — 기존 `staff/page.tsx`·`api/staff/*` 패턴과 동일. 발송 엔진(Plan 1, 구현 완료)의 순수 함수(`estimateCost`, `smsType`, `renderTemplate`)를 클라이언트에서 재사용해 미리보기·예상 비용을 실시간 표시한다.

**Tech Stack:** Next.js 14 App Router, 기존 UI 킷(`Badge`/`Button`/`Card`/`Input`/`Chip`), Tailwind (기존 색·간격 관례), Supabase JS

**기준 문서:** FRD v3.1 §1~§16, HTML 시안(`docs/20260717_solapi_system/고마워할매_대시보드_v3_공유용.html`)의 6개 화면
**제약:** 동료 파일 수정은 `sidebar.tsx`의 메뉴 그룹 추가 **한 곳뿐**. `data-provider.tsx`는 건드리지 않는다(발송 데이터는 페이지별 자체 조회). UI 테스트는 이 프로젝트 관례에 따라 없음 — 검증은 `npx tsc --noEmit` + `npm run build` + 수동 확인.

**공통 관례 (모든 태스크 적용):**
- 페이지 상단: `"use client"` + 필요한 import. 역할 확인은 `useAuth()`의 `user?.role === "owner"`.
- owner 전용 페이지(설정 3종)는 staff 접근 시 `<div className="text-[13px] text-muted">대표(관리자)만 접근할 수 있는 메뉴입니다.</div>` 반환.
- 테이블 스타일: `staff/page.tsx`와 동일 — 컨테이너 `rounded-card border border-border bg-white px-3.5 py-1.5 shadow-card`, th `border-b border-border bg-[#faf7f0] px-2.5 py-3 text-left text-[11.5px] font-semibold text-muted`, td `border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]`.
- 알림 배너: `rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]` (성공), 빨강 계열은 `border-red-100 bg-red-50 text-red-700`.
- 시각 표시는 KST 기준 `new Date(ts).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })`.
- 커밋 메시지 마지막 줄: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, main 직접 커밋.

**단계(stage) 표기 공통 상수** — Task 1에서 만들고 전 페이지가 import:
`STAGE_LABEL: d_7→"D-7", d_3→"D-3", d_1→"D-1", d_day→"당일", manual→"수동"`
`JOB_STATUS_LABEL: scheduled→"발송 예정", processing→"발송 중", success→"성공", failed→"실패", skipped→"제외됨", cancelled_by_change→"예약 변경 취소", cancelled_by_reservation→"예약 취소", cancelled_by_admin→"관리자 취소"`
`JOB_STATUS_VARIANT: success→green, scheduled/processing→amber, 나머지→gray` (실패는 빨강 텍스트 별도)

---

### Task 1: 공통 상수·조회 헬퍼 + 사이드바 메뉴

**Files:**
- Create: `src/lib/notifications/ui-labels.ts`
- Modify: `src/components/layout/sidebar.tsx` (동료 파일 — 메뉴 그룹 추가만)

- [ ] **Step 1: ui-labels.ts 작성**

```ts
// 발송 시스템 화면 공통 라벨·배지 매핑 (FRD v3.1 §11)
import type { BadgeProps } from "@/components/ui/badge";

export const STAGE_LABEL: Record<string, string> = {
  d_7: "D-7", d_3: "D-3", d_1: "D-1", d_day: "당일", manual: "수동",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  scheduled: "발송 예정",
  processing: "발송 중",
  success: "성공",
  failed: "실패",
  skipped: "제외됨",
  cancelled_by_change: "예약 변경 취소",
  cancelled_by_reservation: "예약 취소",
  cancelled_by_admin: "관리자 취소",
};

export const JOB_STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  scheduled: "amber",
  processing: "amber",
  success: "green",
  failed: "gray",
  skipped: "gray",
  cancelled_by_change: "gray",
  cancelled_by_reservation: "gray",
  cancelled_by_admin: "gray",
};

export const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "대기", queued: "대기열", sending: "발송 중", sent: "발송 완료",
  delivered: "수신 완료", failed: "실패", skipped: "제외", cancelled: "취소",
};

export const fmtKst = (ts: string | null | undefined) =>
  ts
    ? new Date(ts).toLocaleString("ko-KR", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "—";
```

- [ ] **Step 2: sidebar.tsx에 메뉴 추가** — import에 `Send, Settings2, MessageCircle, CalendarClock, ListChecks, AlertTriangle`를 lucide-react에서 추가하고, 상수 2개를 `STAFF_EXTRA_NAV` 아래에 추가:

```ts
// 문자 발송 (FRD v3.1 §1) — 일정·이력·실패는 직원도 조회 가능
const NOTIF_NAV = [
  { href: "/notifications/schedule", label: "발송 일정", icon: CalendarClock, isNew: true },
  { href: "/notifications/history", label: "발송 이력", icon: ListChecks, isNew: true },
  { href: "/notifications/failures", label: "실패 관리", icon: AlertTriangle, isNew: true },
];
const NOTIF_ADMIN_NAV = [
  { href: "/settings/notifications", label: "자동 안내 설정", icon: Send, isNew: true },
  { href: "/settings/templates", label: "메시지 템플릿", icon: MessageCircle, isNew: true },
  { href: "/settings/providers/solapi", label: "SOLAPI 설정", icon: Settings2, isNew: true },
];
```

nav 렌더링에서 `MAIN_NAV` 바로 아래(관리자 분기 위)에 삽입:

```tsx
        <div className="px-3.5 pb-1 pt-3 text-[10.5px] tracking-wide text-faint">
          문자 발송
        </div>
        {NOTIF_NAV.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(item.href)} />
        ))}
```

그리고 `isOwner` 분기 안 `ADMIN_NAV.map(...)` 바로 뒤에:

```tsx
            {NOTIF_ADMIN_NAV.map((item) => (
              <NavLink key={item.href} {...item} active={isActive(item.href)} />
            ))}
```

- [ ] **Step 3: 검증과 커밋**

Run: `npx tsc --noEmit`
Expected: 오류 없음

```bash
git add src/lib/notifications/ui-labels.ts src/components/layout/sidebar.tsx
git commit -m "feat: 발송 메뉴·공통 라벨 (사이드바에 문자 발송 그룹 추가)"
```

---

### Task 2: 설정 저장 API + 자동 안내 설정 페이지

**Files:**
- Create: `src/app/api/settings/notifications/route.ts`
- Create: `src/app/(dashboard)/settings/notifications/page.tsx`

- [ ] **Step 1: PUT /api/settings/notifications 라우트**

```ts
// 자동 안내 설정 저장 (FRD §4) — owner 전용, Service Role 쓰기
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { parseBody } from "@/lib/validation";

const bodySchema = z.object({
  settings: z.object({
    notification_enabled: z.boolean(),
    sender_phone: z.string().max(20).nullable(),
    business_phone: z.string().max(20).nullable(),
    business_address: z.string().max(200).nullable(),
  }),
  rules: z.array(
    z.object({
      stage: z.enum(["d_7", "d_3", "d_1", "d_day"]),
      enabled: z.boolean(),
      send_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      sms_template_id: z.string().uuid().nullable(),
    })
  ).max(4),
});

export async function PUT(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { settings, rules } = parsed.data;

  // 활성화하려는 규칙에 템플릿이 없으면 거부 (FRD §4.2)
  const invalid = rules.find((r) => r.enabled && !r.sms_template_id);
  if (invalid) {
    return NextResponse.json(
      { error: `문자 템플릿이 지정되지 않아 활성화할 수 없습니다 (${invalid.stage}).` },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { error: sErr } = await service.from("business_notification_settings").upsert({
    business_id: ctx.businessId,
    ...settings,
    updated_at: new Date().toISOString(),
  });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  for (const r of rules) {
    const { error } = await service.from("notification_rules")
      .update({
        enabled: r.enabled,
        send_time: r.send_time,
        sms_template_id: r.sms_template_id,
        updated_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("business_id", ctx.businessId)
      .eq("stage", r.stage);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await service.from("system_audit_logs").insert({
    business_id: ctx.businessId,
    entity_type: "notification_settings",
    action: "update",
    after_data: { settings, rules },
    actor_id: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: 자동 안내 설정 페이지** — 전체 설정 카드 + 단계별 카드 4장 + 실시간 미리보기 (FRD §4, 시안 "자동 안내 설정" 화면)

```tsx
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
```

- [ ] **Step 3: 검증과 커밋**

Run: `npx tsc --noEmit` → 오류 없음

```bash
git add src/app/api/settings/notifications/route.ts "src/app/(dashboard)/settings/notifications/page.tsx"
git commit -m "feat: 자동 안내 설정 화면과 저장 API"
```

---

### Task 3: 템플릿 CRUD API + 메시지 템플릿 페이지

**Files:**
- Create: `src/app/api/templates/route.ts`
- Create: `src/app/(dashboard)/settings/templates/page.tsx`

- [ ] **Step 1: 템플릿 API (POST 생성 / PUT 수정 / DELETE 삭제)**

```ts
// 문자 템플릿 CRUD (FRD §5) — owner 전용
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { parseBody } from "@/lib/validation";

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  purpose: z.enum(["d_7", "d_3", "d_1", "d_day", "manual"]),
  body_text: z.string().min(1).max(2000),
  is_active: z.boolean().default(true),
});
const deleteSchema = z.object({ id: z.string().uuid() });

const guard = async () => {
  const ctx = await requireUser("owner");
  return ctx ?? null;
};

export async function POST(req: Request) {
  const ctx = await guard();
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, upsertSchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const service = createServiceClient();
  const { id: _ignore, ...data } = parsed.data;
  const { data: row, error } = await service.from("message_templates")
    .insert({ ...data, business_id: ctx.businessId, created_by: ctx.userId, updated_by: ctx.userId })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: row.id });
}

export async function PUT(req: Request) {
  const ctx = await guard();
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, upsertSchema.required({ id: true }));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { id, ...data } = parsed.data;
  const service = createServiceClient();
  // 본문이 바뀌면 버전을 올린다 (발송 이력의 템플릿 버전 추적용)
  const { data: prev } = await service.from("message_templates")
    .select("body_text, version").eq("id", id).eq("business_id", ctx.businessId).single();
  if (!prev) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
  const { error } = await service.from("message_templates")
    .update({
      ...data,
      version: prev.body_text === data.body_text ? prev.version : prev.version + 1,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id).eq("business_id", ctx.businessId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await guard();
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, deleteSchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const service = createServiceClient();
  const { error } = await service.from("message_templates")
    .delete().eq("id", parsed.data.id).eq("business_id", ctx.businessId);
  if (error) {
    // FK 제약: 규칙이 참조 중이면 삭제 불가
    const msg = error.code === "23503"
      ? "자동 안내 규칙이 사용 중인 템플릿입니다. 규칙에서 먼저 해제하세요."
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: 메시지 템플릿 페이지** — 좌: 목록 테이블(템플릿명·단계·예상 유형·활성·수정일, 행 클릭으로 선택), 우: 편집 카드. 편집 카드 구성 (FRD §5.2):
  - 템플릿명 `Input`, 단계 `select`(D-7/D-3/D-1/당일/수동), 본문 `textarea`(높이 180px, 기존 Input과 동일한 테두리 스타일)
  - 변수 칩 6개(`#{고객명} #{방문일} #{인원} #{옵션} #{표시번호} #{사업장전화} #{사업장주소}`) — 클릭 시 본문 커서 위치에 삽입 (`textarea` ref + `selectionStart` 사용)
  - 본문 아래 실시간 표시: `eucKrByteLength(본문)` 바이트 · `smsType()` 배지 · `estimateCost()` 원 — Task 2와 동일하게 `@/lib/notifications/cost` import
  - 미리보기 박스: Task 2의 미리보기와 동일 스타일, SAMPLE_VARS 동일 상수 복사 사용
  - 버튼: `+ 새 템플릿`(폼 초기화), `저장`(id 있으면 PUT 없으면 POST), `삭제`(confirm 후 DELETE), 활성 토글
  - 성공·오류 배너는 공통 관례 스타일. 저장·삭제 후 목록 재조회.
  - 조회는 `createClient()`로 `message_templates` 전체(`order("purpose").order("created_at")`).
  - staff 접근 시 공통 차단 문구.

구현 시 Task 2의 페이지 구조(불러오기 `useCallback load` + `useEffect`, busy/notice/errorMsg 상태, Card 레이아웃)를 그대로 따른다.

- [ ] **Step 3: 검증과 커밋**

Run: `npx tsc --noEmit` → 오류 없음

```bash
git add src/app/api/templates/route.ts "src/app/(dashboard)/settings/templates/page.tsx"
git commit -m "feat: 메시지 템플릿 화면과 CRUD API"
```

---

### Task 4: SOLAPI 상태·테스트 발송 API + SOLAPI 설정 페이지

**Files:**
- Create: `src/app/api/settings/solapi/route.ts` (GET 상태)
- Create: `src/app/api/settings/solapi/test-send/route.ts` (POST 테스트 발송)
- Create: `src/app/(dashboard)/settings/providers/solapi/page.tsx`

- [ ] **Step 1: 상태 조회 GET** (`api/settings/solapi/route.ts`)

```ts
// SOLAPI 연결 상태 (FRD §7) — owner 전용. Secret 원문은 절대 반환하지 않는다.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";

export async function GET() {
  const ctx = await requireUser("owner");
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });

  const keyRegistered = !!process.env.SOLAPI_API_KEY && !!process.env.SOLAPI_API_SECRET;
  const senderNumber = process.env.SOLAPI_SENDER_NUMBER ?? null;
  const mode = process.env.NOTIFICATION_SEND_MODE ?? "dry_run";
  let balance: number | null = null;
  let connected = false;
  if (keyRegistered) {
    try {
      balance = await createSolapiProvider().getBalance();
      connected = true;
    } catch {
      connected = false;
    }
  }
  return NextResponse.json({
    ok: true,
    keyRegistered,
    connected,
    balance,
    senderNumber: senderNumber ? senderNumber.slice(0, 3) + "****" + senderNumber.slice(-4) : null,
    mode,
    checkedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: 테스트 발송 POST** (`api/settings/solapi/test-send/route.ts`) — 수신 번호는 **환경변수 allowlist에 있는 번호만** 허용 (모드와 무관한 하드 가드)

```ts
// SOLAPI 테스트 발송 (FRD §7) — owner 전용, allowlist 번호로만 발송
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { parseBody } from "@/lib/validation";
import { normalizePhone } from "@/lib/notifications/phone";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";
import { estimateCost, smsType } from "@/lib/notifications/cost";

const bodySchema = z.object({ to: z.string().min(9).max(20) });

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const to = normalizePhone(parsed.data.to);
  const allowlist = (process.env.NOTIFICATION_TEST_PHONE_ALLOWLIST ?? "")
    .split(",").map(normalizePhone).filter(Boolean);
  if (!allowlist.includes(to)) {
    return NextResponse.json(
      { error: "테스트 발송은 등록된 테스트 번호로만 가능합니다 (NOTIFICATION_TEST_PHONE_ALLOWLIST)." },
      { status: 400 }
    );
  }
  const text = "[고마워할매] 솔라피 연결 테스트 문자입니다.";
  const result = await createSolapiProvider().sendSms({
    to,
    from: normalizePhone(process.env.SOLAPI_SENDER_NUMBER ?? ""),
    text,
  });
  if (!result.ok) {
    return NextResponse.json({ error: `${result.errorCode}: ${result.errorMessage}` }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    messageType: result.messageType ?? smsType(text),
    cost: estimateCost(text),
  });
}
```

- [ ] **Step 3: SOLAPI 설정 페이지** (`settings/providers/solapi/page.tsx`) — 구성 (FRD §7, 시안 "SOLAPI 설정"):
  - 로드 시 `fetch("/api/settings/solapi")` → 상태 카드 4장 그리드(2열): `연결 상태`(연결됨 green / 실패 red 텍스트), `API Key`(등록됨/미등록 — "Secret 원문 미표시" 서브텍스트), `발신번호`(마스킹된 값), `잔액`(원 단위, 1,000원 미만이면 빨간 경고 배너 "잔액이 부족합니다. 자동 발송이 중단될 수 있어 충전이 필요합니다.")
  - 발송 모드 안내 칩: dry_run→"드라이런(실발송 없음)" gray, allowlist→"테스트 번호만" amber, live→"운영 발송" green
  - 테스트 발송 카드: 수신 번호 `Input`(기본값 빈칸, placeholder "등록된 테스트 번호") + `테스트 문자 보내기` Button → POST test-send → 성공 시 "발송 성공 · {messageType} · 약 {cost}원" 배너, 실패 시 오류 배너
  - "최근 확인" 시각 표시(`fmtKst(checkedAt)`) + `다시 확인` 버튼(재fetch)
  - 카드·배너·버튼은 공통 관례. staff 차단 문구. Task 2 페이지 구조를 따른다.

- [ ] **Step 4: 검증과 커밋**

Run: `npx tsc --noEmit` → 오류 없음

```bash
git add src/app/api/settings/solapi/ "src/app/(dashboard)/settings/providers/"
git commit -m "feat: SOLAPI 설정 화면과 상태·테스트 발송 API"
```

---

### Task 5: 발송 작업 액션 API + 발송 일정 페이지

**Files:**
- Create: `src/app/api/notifications/jobs/route.ts`
- Create: `src/app/(dashboard)/notifications/schedule/page.tsx`

- [ ] **Step 1: 작업 액션 POST** — send_now / exclude / retry / reschedule 한 라우트로 처리

```ts
// 발송 작업 액션 (FRD §8·§10) — owner 전용
// send_now·retry는 즉시 Dispatcher를 1회 실행해 결과를 바로 반영한다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { parseBody } from "@/lib/validation";
import { dispatchDueJobs } from "@/lib/notifications/dispatcher";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";
import { createMockProvider } from "@/lib/notifications/providers/mock-provider";
import type { SendMode } from "@/lib/notifications/types";

const bodySchema = z.object({
  jobId: z.string().uuid(),
  action: z.enum(["send_now", "exclude", "retry", "reschedule"]),
  scheduledAt: z.string().datetime().optional(), // reschedule 전용
});

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { jobId, action, scheduledAt } = parsed.data;

  const service = createServiceClient();
  const { data: job } = await service.from("notification_jobs")
    .select("id, status, business_id").eq("id", jobId).eq("business_id", ctx.businessId).single();
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });

  const now = new Date().toISOString();
  let dispatched = null;

  if (action === "exclude") {
    if (!["scheduled", "failed"].includes(job.status)) {
      return NextResponse.json({ error: "예정 또는 실패 상태만 제외할 수 있습니다." }, { status: 400 });
    }
    await service.from("notification_jobs").update({
      status: "cancelled_by_admin", cancellation_reason: "관리자 제외", updated_at: now,
    }).eq("id", jobId);
  } else if (action === "reschedule") {
    if (job.status !== "scheduled" || !scheduledAt) {
      return NextResponse.json({ error: "예정 상태의 작업만 시각을 바꿀 수 있습니다." }, { status: 400 });
    }
    await service.from("notification_jobs").update({
      scheduled_at: scheduledAt, next_retry_at: null, updated_at: now,
    }).eq("id", jobId);
  } else {
    // send_now: scheduled → 즉시 / retry: failed·cancelled_by_admin → 재발송
    const allowed = action === "send_now" ? ["scheduled"] : ["failed", "cancelled_by_admin"];
    if (!allowed.includes(job.status)) {
      return NextResponse.json({ error: "이 상태에서는 실행할 수 없는 동작입니다." }, { status: 400 });
    }
    await service.from("notification_jobs").update({
      status: "scheduled", scheduled_at: now, next_retry_at: null,
      attempt_count: 0, cancellation_reason: null, updated_at: now,
    }).eq("id", jobId);

    const mode = (process.env.NOTIFICATION_SEND_MODE ?? "dry_run") as SendMode;
    const provider = mode === "dry_run" ? createMockProvider() : createSolapiProvider();
    dispatched = await dispatchDueJobs({
      service, provider, mode,
      allowlist: (process.env.NOTIFICATION_TEST_PHONE_ALLOWLIST ?? "").split(",").map(s => s.trim()).filter(Boolean),
      workerId: `manual-${ctx.userId.slice(0, 8)}`,
    });
  }

  await service.from("system_audit_logs").insert({
    business_id: ctx.businessId,
    entity_type: "notification_job",
    entity_id: jobId,
    action,
    after_data: { scheduledAt: scheduledAt ?? null, dispatched },
    actor_id: ctx.userId,
  });
  return NextResponse.json({ ok: true, dispatched });
}
```

- [ ] **Step 2: 발송 일정 페이지** (`notifications/schedule/page.tsx`) — 구성 (FRD §8, 시안 "발송 일정"):
  - 조회: `notification_jobs` + 중첩 조인 `reservations(guest_name, display_no, visit_start_date)`, `notification_rules(sms_template_id, message_templates(body_text))`. `order("scheduled_at")`.
  - 탭 4개(`Chip` 또는 버튼): `오늘`(KST 오늘 예정) / `이번 주` / `전체 예정`(status=scheduled·processing) / `취소·제외`(cancelled_*·skipped). 필터는 클라이언트 계산.
  - 테이블 컬럼: 예정 시각(`fmtKst`) · 고객 · 표시번호 · 방문일 · 단계(`STAGE_LABEL` Badge) · 상태(`JOB_STATUS_LABEL` + `JOB_STATUS_VARIANT` Badge) · 예상 비용(템플릿 body_text로 `estimateCost` 클라이언트 계산, 템플릿 없으면 "—")
  - owner 행 액션 (staff는 미표시): `지금 발송`(confirm 후 POST send_now → dispatched 요약 배너), `제외`(confirm 후 POST exclude), `시각 변경`(행 확장해 `<Input type="datetime-local">` + 적용 버튼 → POST reschedule, 값은 `new Date(v).toISOString()`으로 변환)
  - 취소·제외 탭에서는 `재생성` 액션 대신 안내 문구: "취소된 일정은 예약 정보가 변경되면 자동으로 재생성됩니다."
  - 하단 안내: "대표는 시각 변경·즉시 발송·일회성 제외를 할 수 있고, 직원은 조회만 가능합니다."
  - 액션 후 목록 재조회. 페이지 구조는 Task 2를 따른다.

- [ ] **Step 3: 검증과 커밋**

Run: `npx tsc --noEmit` → 오류 없음

```bash
git add src/app/api/notifications/jobs/route.ts "src/app/(dashboard)/notifications/schedule/page.tsx"
git commit -m "feat: 발송 일정 화면과 작업 액션 API (즉시 발송·제외·시각 변경)"
```

---

### Task 6: 발송 이력 페이지

**Files:**
- Create: `src/app/(dashboard)/notifications/history/page.tsx`

- [ ] **Step 1: 페이지 구현** — 구성 (FRD §9, 시안 "발송 이력"):
  - 조회: `notification_jobs` where status in `success, failed, skipped, cancelled_by_admin` + `reservations(guest_name, display_no)` + `notification_deliveries(status, provider_message_id, provider_message_type, estimated_cost, actual_cost, sent_at, delivered_at, last_error_code, last_error_message, content_snapshot)`. `order("updated_at", { ascending: false }).limit(100)`.
  - 상태 필터 칩: 전체 / 성공 / 실패 / 제외 (클라이언트 필터)
  - 카드 목록(테이블 아님 — 시안처럼 그룹 카드): 카드 헤더 = `{STAGE_LABEL} 안내 · {고객명}` + 전체 상태 Badge + `fmtKst(updated_at)` + `비용 {actual_cost ?? estimated_cost}원`
  - 카드 본문 = Delivery 행: `문자 ({provider_message_type ?? content_snapshot.sms_type})` · `DELIVERY_STATUS_LABEL` Badge · 오류 시 `{last_error_code}: {last_error_message}` 빨간 텍스트
  - `자세히` 토글로 확장: 최종 문구(content_snapshot.text, `whitespace-pre-line`), 외부 메시지 ID, 발송·수신 시각, 미치환 변수(content_snapshot.missing_vars 있을 때 경고)
  - 조회 전용 — 액션 버튼 없음 (재발송은 실패 관리에서). 페이지 구조는 Task 2를 따른다.

- [ ] **Step 2: 검증과 커밋**

Run: `npx tsc --noEmit` → 오류 없음

```bash
git add "src/app/(dashboard)/notifications/history/page.tsx"
git commit -m "feat: 발송 이력 화면"
```

---

### Task 7: 실패 관리 페이지

**Files:**
- Create: `src/app/(dashboard)/notifications/failures/page.tsx`

- [ ] **Step 1: 페이지 구현** — 구성 (FRD §10, 시안 "실패 관리"):
  - 조회: `notification_jobs` where `status = "failed"` + `reservations(guest_name, display_no, guest_phone)` + `notification_deliveries(last_error_code, last_error_message, failed_at)`. `order("updated_at", { ascending: false })`.
  - 실패 카드: 헤더 `✕ 최종 실패` 빨간 배지 + 고객명 + 표시번호 + `{STAGE_LABEL} · 문자`
  - 실패 사유 줄: job.cancellation_reason 또는 delivery의 `last_error_code: last_error_message`
  - 전화번호 힌트: `guest_phone`에 `*` 포함 시 amber 배너 "마스킹된 번호입니다 — 예약 상세에서 연락처를 수정한 뒤 재발송하세요."
  - owner 액션 (staff 미표시): `재발송`(confirm 후 Task 5의 API로 POST `{action:"retry"}` → dispatched 요약 배너 + 재조회), `발송 제외`(POST exclude), `처리 완료`(= exclude와 동일 API, confirm 문구만 "이 실패 건을 처리 완료로 표시할까요?")
  - 실패 0건일 때: "확인이 필요한 실패 건이 없습니다 🎉" 문구
  - 페이지 구조는 Task 2를 따른다.

- [ ] **Step 2: 검증과 커밋**

Run: `npx tsc --noEmit` → 오류 없음

```bash
git add "src/app/(dashboard)/notifications/failures/page.tsx"
git commit -m "feat: 실패 관리 화면 (재발송·제외)"
```

---

### Task 8: 전체 빌드 검증

- [ ] **Step 1: 테스트·타입·프로덕션 빌드**

```bash
npm test          # 기존 25개 통과 유지
npx tsc --noEmit  # 오류 없음
npm run build     # 6개 신규 페이지 포함 빌드 성공
```

- [ ] **Step 2: 수동 확인 목록** (dev 서버 + 브라우저, dry_run 모드)

1. 사이드바에 "문자 발송" 그룹 3개 + 관리자 메뉴에 설정 3개가 보인다 (staff 계정은 설정 3종 미노출)
2. 자동 안내 설정: 토글·시간·템플릿 변경 → 저장 → 새로고침 후 유지
3. 메시지 템플릿: 새 템플릿 생성 → 바이트·유형·비용 실시간 변화 → 수정 저장 시 버전 증가
4. SOLAPI 설정: 연결 상태·잔액 표시, 테스트 발송(allowlist 번호)
5. 발송 일정: 테스트 예약 생성 후 4건 표시, 지금 발송(dry_run) → 이력으로 이동
6. 발송 이력: dry_run 건 문구·비용 확인 / 실패 관리: 빈 상태 문구

- [ ] **Step 3: Commit** (검증 중 수정이 있었던 경우)

---

## 완료 기준

- `npm run build` 성공, 기존 테스트 25개 통과 유지
- FRD §1 화면 6개가 모두 접근 가능하고 권한 매트릭스(owner/staff)가 FRD §2와 일치
- 설정 저장·템플릿 CRUD·즉시 발송·제외·재발송이 API를 통해 동작하고 감사 로그가 남는다
- 예상 비용·SMS/LMS 판별이 엔진과 같은 함수로 계산되어 일치한다

## 이 계획이 다루지 않는 것

- Vercel 배포, 0008 Cron 등록, SOLAPI Webhook URL 등록 (배포 단계)
- 대시보드 홈 KPI·예약 상세 연동 (동료 영역)
- 모바일 최적화 세부 (기존 대시보드 수준의 반응형만)
