# 솔라피 문자 발송 엔진 구현 계획 (Plan 1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 예약 데이터를 읽어 D-7·D-3·D-1·당일 문자를 자동 발송하는 백엔드 엔진(DB 스키마, 발송 파이프라인, SOLAPI 연동, Webhook, Cron API)을 dry_run 모드로 검증 가능한 상태까지 구축한다.

**Architecture:** Supabase 트리거가 예약 변경 시 `notification_jobs`를 생성·재계산하고, Cron이 5분마다 `/api/cron/notifications/dispatch`를 호출해 도착한 Job을 잠금과 함께 가져가(`FOR UPDATE SKIP LOCKED`) 재검증 → 템플릿 치환 → SOLAPI 발송한다. 결과는 Webhook(`X-SOLAPI-SECRET` 헤더 검증)으로 수신해 Delivery/Job 상태를 확정한다. 발송 모드(dry_run/allowlist/live)는 환경변수로 제어한다.

**Tech Stack:** Next.js 14 Route Handlers, Supabase PostgreSQL(plpgsql·pg_cron), solapi SDK 5.5.1, Zod, Vitest

**기준 문서:** `docs/20260717_solapi_system/` PRD·FRD·TRD v3.1
**제약:** 마이그레이션은 0005부터. 동료 영역(대시보드 홈·예약 목록/상세, `apply_import_plan`)은 수정하지 않음. `reservations`에는 트리거 1개만 추가(동료에게 커밋 후 공유). 관리자 UI 6페이지는 **Plan 2**(별도 문서)로 분리 — 이 계획만으로 dry_run 발송까지 동작·검증 가능.

**마이그레이션 적용 방식:** 이 프로젝트는 Supabase Dashboard → SQL Editor에 파일 전체를 붙여넣어 실행한다(0003·0004와 동일). 적용 단계는 사람이 수행하고, 검증 쿼리로 확인한다.

---

### Task 1: 의존성 설치와 Vitest 설정

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: 기존 의존성 + 신규 패키지 설치**

```bash
npm install
npm install solapi@5.5.1
npm install -D vitest
```

- [ ] **Step 2: vitest.config.ts 작성**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: package.json scripts에 test 추가**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run"
}
```

- [ ] **Step 4: 설치 확인**

Run: `npx vitest run --passWithNoTests`
Expected: `No test files found` 문구와 함께 정상 종료(exit 0)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: solapi SDK·vitest 설치 및 테스트 러너 설정"
```

---

### Task 2: 전화번호 정규화·검증 (`phone.ts`)

TRD §16.3. 마스킹 번호(`****`)는 무효. 정규화 후 `01X` 시작 10~11자리만 유효.

**Files:**
- Create: `src/lib/notifications/phone.ts`
- Test: `src/lib/notifications/phone.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { isValidMobile, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("하이픈·공백을 제거하고 숫자만 남긴다", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone(" 010 1234 5678 ")).toBe("01012345678");
  });
});

describe("isValidMobile", () => {
  it("정상 휴대전화 형식을 통과시킨다", () => {
    expect(isValidMobile("010-1234-5678")).toBe(true);
    expect(isValidMobile("01112345678")).toBe(true); // 10자리
  });
  it("네이버 마스킹 값을 거부한다", () => {
    expect(isValidMobile("******4158")).toBe(false);
    expect(isValidMobile("010-****-5678")).toBe(false);
  });
  it("빈 값·자릿수 오류·유선번호를 거부한다", () => {
    expect(isValidMobile("")).toBe(false);
    expect(isValidMobile("010-1234")).toBe(false);
    expect(isValidMobile("02-123-4567")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/notifications/phone.test.ts`
Expected: FAIL — `Cannot find module './phone'`

- [ ] **Step 3: 구현**

```ts
// 전화번호 정규화·검증 (TRD §16.3)
// 네이버는 방문일 경과 후 번호를 마스킹(******4158)하므로 '*' 포함 값은 무효.

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isValidMobile(raw: string): boolean {
  if (raw.includes("*")) return false;
  return /^01[016789][0-9]{7,8}$/.test(normalizePhone(raw));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/notifications/phone.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/phone.ts src/lib/notifications/phone.test.ts
git commit -m "feat: 전화번호 정규화·검증 유틸 (마스킹 번호 무효 처리)"
```

---

### Task 3: SMS/LMS 판별과 비용 계산 (`cost.ts`)

PRD §7·§14. EUC-KR 기준 90바이트(한글 45자) 이하 SMS. 단가는 하드코딩하지 않고 매개변수로 받되 기본값 18/45원.

**Files:**
- Create: `src/lib/notifications/cost.ts`
- Test: `src/lib/notifications/cost.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { estimateCost, eucKrByteLength, smsType } from "./cost";

describe("eucKrByteLength", () => {
  it("한글 2바이트, 영문·숫자 1바이트로 계산한다", () => {
    expect(eucKrByteLength("abc")).toBe(3);
    expect(eucKrByteLength("가나다")).toBe(6);
    expect(eucKrByteLength("가a1")).toBe(4);
  });
});

describe("smsType", () => {
  it("90바이트 이하는 SMS", () => {
    expect(smsType("가".repeat(45))).toBe("SMS"); // 90바이트
  });
  it("90바이트 초과는 LMS", () => {
    expect(smsType("가".repeat(46))).toBe("LMS"); // 92바이트
  });
});

describe("estimateCost", () => {
  it("기본 단가 SMS 18원 / LMS 45원", () => {
    expect(estimateCost("짧은 문자")).toBe(18);
    expect(estimateCost("가".repeat(46))).toBe(45);
  });
  it("설정 단가를 넘기면 그 값을 쓴다", () => {
    expect(estimateCost("짧은 문자", { smsCost: 20, lmsCost: 50 })).toBe(20);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/notifications/cost.test.ts`
Expected: FAIL — `Cannot find module './cost'`

- [ ] **Step 3: 구현**

```ts
// SMS/LMS 판별과 비용 (PRD §7, §14)
// 기본 단가는 2026-07 solapi.com/pricing 표준 단가(VAT 미포함).
// 운영 단가는 business_notification_settings의 값을 넘겨받아 사용한다.

export const DEFAULT_SMS_COST = 18;
export const DEFAULT_LMS_COST = 45;
export const SMS_BYTE_LIMIT = 90; // EUC-KR 기준

export function eucKrByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return bytes;
}

export function smsType(text: string): "SMS" | "LMS" {
  return eucKrByteLength(text) <= SMS_BYTE_LIMIT ? "SMS" : "LMS";
}

export function estimateCost(
  text: string,
  unit: { smsCost?: number; lmsCost?: number } = {}
): number {
  const { smsCost = DEFAULT_SMS_COST, lmsCost = DEFAULT_LMS_COST } = unit;
  return smsType(text) === "SMS" ? smsCost : lmsCost;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/notifications/cost.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/cost.ts src/lib/notifications/cost.test.ts
git commit -m "feat: SMS/LMS 판별·비용 계산 (EUC-KR 90바이트 기준)"
```

---

### Task 4: 템플릿 변수 치환 (`template-renderer.ts`)

PRD §10. 변수는 `#{고객명}` 형식. 값이 없는 변수는 치환하지 않고 `missing`으로 보고한다(발송 차단 판단은 호출자 몫).

**Files:**
- Create: `src/lib/notifications/template-renderer.ts`
- Test: `src/lib/notifications/template-renderer.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template-renderer";

describe("renderTemplate", () => {
  it("변수를 값으로 치환한다", () => {
    const r = renderTemplate("#{고객명}님, #{방문일} 방문 안내드립니다.", {
      고객명: "김민지",
      방문일: "2026년 8월 20일 (목)",
    });
    expect(r.text).toBe("김민지님, 2026년 8월 20일 (목) 방문 안내드립니다.");
    expect(r.missing).toEqual([]);
  });
  it("값이 없는 변수는 원문 유지 + missing 보고", () => {
    const r = renderTemplate("#{고객명}님 #{인원}명", { 고객명: "김민지" });
    expect(r.text).toBe("김민지님 #{인원}명");
    expect(r.missing).toEqual(["인원"]);
  });
  it("변수가 없으면 원문 그대로", () => {
    const r = renderTemplate("안녕하세요.", {});
    expect(r.text).toBe("안녕하세요.");
    expect(r.missing).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/notifications/template-renderer.test.ts`
Expected: FAIL — `Cannot find module './template-renderer'`

- [ ] **Step 3: 구현**

```ts
// 문자 템플릿 변수 치환 (PRD §10)
// 지원 변수: 고객명·방문일·방문시간·인원·옵션·표시번호·예약번호·사업장명·사업장전화·사업장주소

export function renderTemplate(
  body: string,
  vars: Record<string, string | undefined>
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(/#\{([^}]+)\}/g, (whole, key: string) => {
    const v = vars[key];
    if (v === undefined || v === "") {
      missing.push(key);
      return whole;
    }
    return v;
  });
  return { text, missing };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/notifications/template-renderer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/template-renderer.ts src/lib/notifications/template-renderer.test.ts
git commit -m "feat: 문자 템플릿 변수 치환기"
```

---

### Task 5: 마이그레이션 0005 — 발송 코어 테이블

TRD §9~§11. 테이블 7종 + 인덱스 + 활성 상태 한정 부분 유니크.

**Files:**
- Create: `supabase/migrations/0005_notification_core.sql`

- [ ] **Step 1: SQL 파일 작성** (TRD §9의 DDL 그대로 + 단가 설정 컬럼)

```sql
-- 0005: 문자 발송 시스템 코어 테이블 (TRD v3.1 §9~§11)
-- 적용: Dashboard → SQL Editor 에 전체 붙여넣기 → Run

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE business_notification_settings (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  sender_phone text,
  business_phone text,
  business_address text,
  notification_enabled boolean NOT NULL DEFAULT false,
  sms_unit_cost numeric(12,4) NOT NULL DEFAULT 18,
  lms_unit_cost numeric(12,4) NOT NULL DEFAULT 45,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  purpose text NOT NULL CHECK (purpose IN ('d_7','d_3','d_1','d_day','manual')),
  body_text text NOT NULL,
  variable_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id),
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('d_7','d_3','d_1','d_day')),
  offset_days integer NOT NULL CHECK (offset_days BETWEEN 0 AND 365),
  send_time time NOT NULL,
  sms_template_id uuid REFERENCES message_templates(id),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES profiles(id),
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, stage)
);

CREATE TABLE reservation_notification_preferences (
  reservation_id uuid PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  exclusion_reason text,
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES notification_rules(id),
  stage text NOT NULL CHECK (stage IN ('d_7','d_3','d_1','d_day','manual')),
  purpose text NOT NULL DEFAULT 'reservation_notice',
  base_visit_date date,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (
    status IN (
      'scheduled','processing','success','failed','skipped',
      'cancelled_by_change','cancelled_by_reservation','cancelled_by_admin'
    )
  ),
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  cancellation_reason text,
  parent_job_id uuid REFERENCES notification_jobs(id),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  provider text NOT NULL DEFAULT 'solapi' CHECK (provider IN ('solapi')),
  sequence_no integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','queued','sending','sent','delivered','failed','skipped','cancelled')
  ),
  recipient_masked text,
  recipient_hash text,
  provider_group_id text,
  provider_message_id text,
  provider_message_type text,
  template_id uuid REFERENCES message_templates(id),
  content_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_cost numeric(12,4),
  actual_cost numeric(12,4),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_error_message text,
  requested_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  provider_raw_last_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, channel, sequence_no)
);

CREATE TABLE provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'solapi' CHECK (provider IN ('solapi')),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  provider_message_id text,
  provider_group_id text,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE system_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid REFERENCES profiles(id),
  actor_type text NOT NULL DEFAULT 'user'
    CHECK (actor_type IN ('user','cron','webhook','system')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_jobs_due
  ON notification_jobs(status, scheduled_at, next_retry_at);
CREATE INDEX idx_notification_jobs_reservation
  ON notification_jobs(reservation_id, stage, base_visit_date);
CREATE INDEX idx_notification_deliveries_job
  ON notification_deliveries(job_id);
CREATE INDEX idx_notification_deliveries_provider_message
  ON notification_deliveries(provider, provider_message_id);

-- 활성 상태에만 적용하는 부분 유니크 (TRD §11)
-- 취소·실패 Job은 dedupe_key를 점유하지 않으므로 재생성·재발송 가능
CREATE UNIQUE INDEX uq_notification_jobs_dedupe_active
  ON notification_jobs(dedupe_key)
  WHERE status IN ('scheduled','processing','success');
```

- [ ] **Step 2: SQL Editor에서 실행** (사람이 수행)

Supabase Dashboard → SQL Editor → 파일 전체 붙여넣기 → Run
Expected: `Success. No rows returned`

- [ ] **Step 3: 적용 검증** (SQL Editor)

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like 'notification%' order by 1;
```
Expected: `notification_deliveries`, `notification_jobs`, `notification_rules` 3행 포함

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_notification_core.sql
git commit -m "feat: 발송 코어 테이블 마이그레이션 (0005)"
```

---

### Task 6: 마이그레이션 0006 — 일정 생성·Claim·상태 계산 함수와 트리거

TRD §12~§15·§18~§19. `reservations` 트리거가 포함되므로 **커밋 후 동료에게 공유**.

**Files:**
- Create: `supabase/migrations/0006_notification_functions.sql`

- [ ] **Step 1: SQL 파일 작성**

```sql
-- 0006: 일정 생성·Claim·상태 계산·잠금 복구 (TRD v3.1 §12~§15, §18~§19)
-- 적용: Dashboard → SQL Editor 에 전체 붙여넣기 → Run
-- ⚠️ reservations에 트리거를 추가한다 — 적용 전 동료와 공유할 것.

-- ============================================================
-- 일정 생성·재계산: 예약 1건의 발송 작업을 현재 상태 기준으로 맞춘다
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_reservation_notification_jobs(p_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r reservations%ROWTYPE;
  s business_notification_settings%ROWTYPE;
  v_pref_enabled boolean;
  rule RECORD;
  v_scheduled timestamptz;
  v_key text;
  v_phone text;
BEGIN
  SELECT * INTO r FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- 1) 무효가 된 미발송 작업 취소 (성공 이력은 보존)
  UPDATE notification_jobs SET
    status = CASE WHEN r.reservation_status = 'cancelled'
                  THEN 'cancelled_by_reservation' ELSE 'cancelled_by_change' END,
    cancellation_reason = CASE WHEN r.reservation_status = 'cancelled'
                  THEN '예약 취소' ELSE '예약 변경' END,
    updated_at = now()
  WHERE reservation_id = p_reservation_id
    AND status = 'scheduled'
    AND (r.reservation_status = 'cancelled'
         OR base_visit_date IS DISTINCT FROM r.visit_start_date);

  -- 2) 생성 조건 검사 (TRD §12)
  IF r.reservation_status NOT IN ('confirmed','changed') THEN RETURN; END IF;

  SELECT * INTO s FROM business_notification_settings WHERE business_id = r.business_id;
  IF NOT FOUND OR NOT s.notification_enabled THEN RETURN; END IF;

  SELECT enabled INTO v_pref_enabled
  FROM reservation_notification_preferences WHERE reservation_id = p_reservation_id;
  IF FOUND AND NOT v_pref_enabled THEN RETURN; END IF;

  v_phone := regexp_replace(coalesce(r.guest_phone, ''), '[^0-9]', '', 'g');
  IF v_phone !~ '^01[0-9]{8,9}$' THEN RETURN; END IF;

  -- 3) 활성 규칙별 미래 작업 생성 (지난 시점은 생성하지 않음, PRD §9.1)
  FOR rule IN
    SELECT * FROM notification_rules
    WHERE business_id = r.business_id AND enabled AND sms_template_id IS NOT NULL
  LOOP
    v_scheduled := ((r.visit_start_date - rule.offset_days) + rule.send_time)
                   AT TIME ZONE 'Asia/Seoul';
    IF v_scheduled <= now() THEN CONTINUE; END IF;

    -- dedupe_key (TRD §11): 활성 상태 부분 유니크와 충돌 시 조용히 무시
    v_key := encode(digest(
      r.business_id::text || ':' || r.id::text || ':' || rule.stage || ':'
      || r.visit_start_date::text || ':' || rule.version::text, 'sha256'), 'hex');

    INSERT INTO notification_jobs
      (business_id, reservation_id, rule_id, stage, base_visit_date, scheduled_at, dedupe_key)
    VALUES
      (r.business_id, r.id, rule.id, rule.stage, r.visit_start_date, v_scheduled, v_key)
    ON CONFLICT (dedupe_key) WHERE status IN ('scheduled','processing','success')
    DO NOTHING;
  END LOOP;
END;
$$;

-- ============================================================
-- 예약 변경 감지 트리거 (⚠️ 동료 테이블 — 사전 공유)
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_refresh_reservation_notification_jobs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_reservation_notification_jobs(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_notification_refresh ON reservations;
CREATE TRIGGER trg_reservation_notification_refresh
AFTER INSERT OR UPDATE OF visit_start_date, reservation_status, guest_phone
ON reservations
FOR EACH ROW
EXECUTE FUNCTION trigger_refresh_reservation_notification_jobs();

-- ============================================================
-- Job Claim (TRD §14) — 잠금과 함께 도착 작업을 가져간다
-- ============================================================
CREATE OR REPLACE FUNCTION claim_due_notification_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 20
)
RETURNS SETOF notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM notification_jobs
    WHERE status = 'scheduled'
      AND scheduled_at <= now()
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY scheduled_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE notification_jobs j
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      attempt_count = attempt_count + 1,
      updated_at = now()
  FROM candidates c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

-- ============================================================
-- Job 상태 계산 (TRD §18) — 성공 후 실패 반전도 이 함수로 수렴
-- ============================================================
CREATE OR REPLACE FUNCTION recalculate_notification_job_status(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_ok boolean;
  v_has_failed boolean;
BEGIN
  SELECT
    bool_or(status IN ('sent','delivered')),
    bool_or(status = 'failed')
  INTO v_has_ok, v_has_failed
  FROM notification_deliveries WHERE job_id = p_job_id;

  IF v_has_ok THEN
    UPDATE notification_jobs SET status = 'success', updated_at = now()
    WHERE id = p_job_id AND status IN ('processing','success','failed');
  ELSIF v_has_failed THEN
    UPDATE notification_jobs SET status = 'failed', updated_at = now()
    WHERE id = p_job_id AND status IN ('processing','success');
  END IF;
END;
$$;

-- ============================================================
-- 잠금 복구 (TRD §19): 15분 이상 processing인 작업
--   Provider ID 없음 → 재예약 / 있음 → 상태 대조 대상으로 남김
-- ============================================================
CREATE OR REPLACE FUNCTION recover_stuck_notification_jobs()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE notification_jobs j
  SET status = 'scheduled', locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE j.status = 'processing'
    AND j.locked_at < now() - interval '15 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM notification_deliveries d
      WHERE d.job_id = j.id AND d.provider_message_id IS NOT NULL
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 서버(Service Role) 전용 — 클라이언트 직접 호출 차단
REVOKE EXECUTE ON FUNCTION refresh_reservation_notification_jobs(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_due_notification_jobs(text, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION recalculate_notification_job_status(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION recover_stuck_notification_jobs() FROM public, anon, authenticated;
```

- [ ] **Step 2: SQL Editor에서 실행** (사람이 수행)

Expected: `Success. No rows returned`

- [ ] **Step 3: 트리거 동작 검증** (SQL Editor — 설정이 꺼져 있으므로 Job이 생기지 않아야 정상)

```sql
-- 트리거는 visit_start_date·reservation_status·guest_phone 변경에만 발화하므로
-- guest_phone을 같은 값으로 다시 넣어 발화시킨다
update reservations set guest_phone = guest_phone
where id = (select id from reservations limit 1);
select count(*) from notification_jobs;
```
Expected: 오류 없이 실행되고 `0` (business_notification_settings가 아직 없으므로 생성 안 됨 = 안전장치 동작)

- [ ] **Step 4: Commit + 동료 공유**

```bash
git add supabase/migrations/0006_notification_functions.sql
git commit -m "feat: 발송 일정 생성·Claim·상태 계산 함수와 예약 트리거 (0006)"
```
동료에게 전달: "reservations에 AFTER 트리거 1개 추가됨(0006). 예약 저장이 실패하면 이 트리거부터 의심할 것."

---

### Task 7: 마이그레이션 0007 — RLS

TRD §21. 신규 테이블만. 기존 테이블 정책은 건드리지 않는다.

**Files:**
- Create: `supabase/migrations/0007_notification_rls.sql`

- [ ] **Step 1: SQL 파일 작성**

```sql
-- 0007: 발송 시스템 RLS (TRD v3.1 §21)
-- 원칙: 같은 사업장만 조회. 설정·템플릿·규칙 쓰기는 owner.
--       jobs/deliveries/webhook_events 쓰기는 Service Role 전용(정책 없음 = 차단).

ALTER TABLE business_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_audit_logs ENABLE ROW LEVEL SECURITY;

-- 요청자의 business_id (0002에서 만든 패턴과 동일하게 profiles 경유)
CREATE OR REPLACE FUNCTION notif_current_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT business_id FROM profiles WHERE id = auth.uid() $$;

-- 조회: 같은 사업장 구성원(owner/staff 공통)
CREATE POLICY sel_notif_settings ON business_notification_settings
  FOR SELECT USING (business_id = notif_current_business_id());
CREATE POLICY sel_templates ON message_templates
  FOR SELECT USING (business_id = notif_current_business_id());
CREATE POLICY sel_rules ON notification_rules
  FOR SELECT USING (business_id = notif_current_business_id());
CREATE POLICY sel_jobs ON notification_jobs
  FOR SELECT USING (business_id = notif_current_business_id());
CREATE POLICY sel_deliveries ON notification_deliveries
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM notification_jobs j
    WHERE j.id = job_id AND j.business_id = notif_current_business_id()));
CREATE POLICY sel_prefs ON reservation_notification_preferences
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.id = reservation_id AND r.business_id = notif_current_business_id()));
CREATE POLICY sel_audit ON system_audit_logs
  FOR SELECT USING (business_id = notif_current_business_id());
-- provider_webhook_events: 관리자 화면에서 직접 조회하지 않음 — 정책 없음(차단)

-- 쓰기: 설정·템플릿·규칙·예약별 설정은 서버 API(Service Role)로만 수행한다.
-- Service Role은 RLS를 우회하므로 별도 INSERT/UPDATE 정책을 만들지 않는다.
```

- [ ] **Step 2: SQL Editor에서 실행** (사람이 수행)

Expected: `Success. No rows returned`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_notification_rls.sql
git commit -m "feat: 발송 시스템 RLS 정책 (0007)"
```

---

### Task 8: 마이그레이션 0008·0009 — Cron 등록 템플릿과 기본 데이터

TRD §13·§26. pg_cron이 Vercel API를 호출한다. CRON_SECRET은 파일에 커밋하지 않고 실행 시 치환한다.

**Files:**
- Create: `supabase/migrations/0008_notification_cron.sql`
- Create: `supabase/migrations/0009_seed_notification_defaults.sql`

- [ ] **Step 1: 0008 작성**

```sql
-- 0008: Cron 등록 (TRD v3.1 §13)
-- ⚠️ 실행 전 치환: {{APP_BASE_URL}} → 배포 URL, {{CRON_SECRET}} → 환경변수와 같은 값
--    (Secret을 git에 커밋하지 않기 위해 실행 시점에 채운다)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 메시지 발송: 5분마다
SELECT cron.schedule('notification-dispatch', '*/5 * * * *', $$
  SELECT net.http_post(
    url := '{{APP_BASE_URL}}/api/cron/notifications/dispatch',
    headers := '{"Authorization": "Bearer {{CRON_SECRET}}", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- 잠금 복구: 15분마다
SELECT cron.schedule('notification-recover-locks', '*/15 * * * *', $$
  SELECT net.http_post(
    url := '{{APP_BASE_URL}}/api/cron/notifications/recover-locks',
    headers := '{"Authorization": "Bearer {{CRON_SECRET}}", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- Provider 상태 대조: 30분마다
SELECT cron.schedule('notification-reconcile', '*/30 * * * *', $$
  SELECT net.http_post(
    url := '{{APP_BASE_URL}}/api/cron/notifications/reconcile',
    headers := '{"Authorization": "Bearer {{CRON_SECRET}}", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
```

- [ ] **Step 2: 0009 작성** (기본 설정·템플릿·규칙 — 모두 비활성 상태로 시드, 활성화는 대표가 UI에서)

```sql
-- 0009: 기본 규칙 시드 (PRD §3.1) — notification_enabled=false, 규칙 enabled=false로 안전하게 시작

INSERT INTO business_notification_settings (business_id)
SELECT id FROM businesses
ON CONFLICT (business_id) DO NOTHING;

WITH tpl AS (
  INSERT INTO message_templates (business_id, name, purpose, body_text, variable_keys)
  SELECT b.id, t.name, t.purpose, t.body, t.vars
  FROM businesses b,
  (VALUES
    ('D-7 방문 안내','d_7',
     E'#{고객명}님, 안녕하세요. 고마워할매입니다.\n#{방문일} 방문 예약이 확정되어 안내드립니다.\n· 인원: #{인원}명\n· 옵션: #{옵션}\n문의: #{사업장전화}',
     '["고객명","방문일","인원","옵션","사업장전화"]'::jsonb),
    ('D-3 준비 안내','d_3',
     E'#{고객명}님, 방문이 3일 앞으로 다가왔습니다.\n· 방문일: #{방문일}\n· 인원: #{인원}명\n준비물과 오시는 길은 문의 주세요: #{사업장전화}',
     '["고객명","방문일","인원","사업장전화"]'::jsonb),
    ('D-1 최종 안내','d_1',
     E'#{고객명}님, 내일 방문 예정입니다.\n· 방문일: #{방문일}\n· 인원: #{인원}명\n· 예약번호: #{표시번호}\n주소: #{사업장주소}',
     '["고객명","방문일","인원","표시번호","사업장주소"]'::jsonb),
    ('당일 방문 안내','d_day',
     E'#{고객명}님, 오늘 방문일입니다. 조심히 오세요!\n주소: #{사업장주소}\n문의: #{사업장전화}',
     '["고객명","사업장주소","사업장전화"]'::jsonb)
  ) AS t(name, purpose, body, vars)
  RETURNING id, business_id, purpose
)
INSERT INTO notification_rules (business_id, stage, offset_days, send_time, sms_template_id, enabled)
SELECT tpl.business_id, tpl.purpose,
  CASE tpl.purpose WHEN 'd_7' THEN 7 WHEN 'd_3' THEN 3 WHEN 'd_1' THEN 1 ELSE 0 END,
  CASE tpl.purpose WHEN 'd_1' THEN time '15:00' WHEN 'd_day' THEN time '08:00' ELSE time '10:00' END,
  tpl.id, false
FROM tpl
ON CONFLICT (business_id, stage) DO NOTHING;
```

- [ ] **Step 3: 0009 실행 후 검증** (0008은 배포 URL 확정 후 실행하므로 지금은 파일만 커밋)

```sql
select stage, offset_days, send_time, enabled from notification_rules order by offset_days desc;
```
Expected: d_7/7/10:00, d_3/3/10:00, d_1/1/15:00, d_day/0/08:00 — 모두 `enabled=false`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_notification_cron.sql supabase/migrations/0009_seed_notification_defaults.sql
git commit -m "feat: Cron 등록 템플릿과 기본 규칙 시드 (0008, 0009)"
```

---

### Task 9: 타입·발송 판단 로직 (`types.ts`, `dispatch-policy.ts`)

발송 직전 재검증(TRD §15)과 발송 모드 게이트(dry_run/allowlist/live)는 순수 함수로 만들어 TDD.

**Files:**
- Create: `src/lib/notifications/types.ts`
- Create: `src/lib/notifications/dispatch-policy.ts`
- Test: `src/lib/notifications/dispatch-policy.test.ts`

- [ ] **Step 1: types.ts 작성** (DB 행 스냅샷 — snake_case 그대로, 서버 전용)

```ts
// 발송 엔진 내부 타입 — DB 행(snake_case)을 그대로 다룬다 (서버 전용)

export interface JobRow {
  id: string;
  business_id: string;
  reservation_id: string;
  rule_id: string | null;
  stage: "d_7" | "d_3" | "d_1" | "d_day" | "manual";
  base_visit_date: string | null;
  scheduled_at: string;
  status: string;
  attempt_count: number;
}

export interface ReservationSnapshot {
  id: string;
  guest_name: string;
  guest_phone: string;
  visit_start_date: string;
  reservation_status: "confirmed" | "changed" | "cancelled";
}

export type SendMode = "dry_run" | "allowlist" | "live";

export type SkipReason =
  | "reservation_cancelled"
  | "visit_date_changed"
  | "notification_disabled"
  | "invalid_phone"
  | "already_succeeded";

export type DispatchDecision =
  | { action: "skip"; reason: SkipReason }
  | { action: "dry_run" }
  | { action: "blocked_by_allowlist" }
  | { action: "send" };
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { decideDispatch, revalidateJob } from "./dispatch-policy";
import type { JobRow, ReservationSnapshot } from "./types";

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: "j1", business_id: "b1", reservation_id: "r1", rule_id: "ru1",
  stage: "d_1", base_visit_date: "2026-08-20", scheduled_at: "2026-08-19T06:00:00Z",
  status: "processing", attempt_count: 1, ...over,
});
const res = (over: Partial<ReservationSnapshot> = {}): ReservationSnapshot => ({
  id: "r1", guest_name: "김민지", guest_phone: "010-1234-5678",
  visit_start_date: "2026-08-20", reservation_status: "confirmed", ...over,
});

describe("revalidateJob (발송 직전 재검증, TRD §15)", () => {
  it("정상 예약은 통과", () => {
    expect(revalidateJob(job(), res(), true, false)).toBeNull();
  });
  it("취소 예약", () => {
    expect(revalidateJob(job(), res({ reservation_status: "cancelled" }), true, false))
      .toBe("reservation_cancelled");
  });
  it("방문일이 바뀐 작업", () => {
    expect(revalidateJob(job(), res({ visit_start_date: "2026-08-25" }), true, false))
      .toBe("visit_date_changed");
  });
  it("자동 안내 비활성", () => {
    expect(revalidateJob(job(), res(), false, false)).toBe("notification_disabled");
  });
  it("마스킹 전화번호", () => {
    expect(revalidateJob(job(), res({ guest_phone: "******4158" }), true, false))
      .toBe("invalid_phone");
  });
  it("동일 단계 이미 성공", () => {
    expect(revalidateJob(job(), res(), true, true)).toBe("already_succeeded");
  });
});

describe("decideDispatch (발송 모드 게이트, TRD §22)", () => {
  it("dry_run이면 외부 발송 없이 기록만", () => {
    expect(decideDispatch("dry_run", "01012345678", [])).toEqual({ action: "dry_run" });
  });
  it("allowlist 모드: 목록에 있으면 발송", () => {
    expect(decideDispatch("allowlist", "01012345678", ["01012345678"]))
      .toEqual({ action: "send" });
  });
  it("allowlist 모드: 목록에 없으면 차단", () => {
    expect(decideDispatch("allowlist", "01099998888", ["01012345678"]))
      .toEqual({ action: "blocked_by_allowlist" });
  });
  it("live면 발송", () => {
    expect(decideDispatch("live", "01012345678", [])).toEqual({ action: "send" });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/notifications/dispatch-policy.test.ts`
Expected: FAIL — `Cannot find module './dispatch-policy'`

- [ ] **Step 4: 구현**

```ts
// 발송 직전 재검증(TRD §15)과 발송 모드 게이트(TRD §22) — 순수 함수
import { isValidMobile, normalizePhone } from "./phone";
import type { DispatchDecision, JobRow, ReservationSnapshot, SendMode, SkipReason } from "./types";

export function revalidateJob(
  job: JobRow,
  reservation: ReservationSnapshot,
  notificationEnabled: boolean,
  sameStageAlreadySucceeded: boolean
): SkipReason | null {
  if (reservation.reservation_status === "cancelled") return "reservation_cancelled";
  if (job.base_visit_date !== null && job.base_visit_date !== reservation.visit_start_date)
    return "visit_date_changed";
  if (!notificationEnabled) return "notification_disabled";
  if (!isValidMobile(reservation.guest_phone)) return "invalid_phone";
  if (sameStageAlreadySucceeded) return "already_succeeded";
  return null;
}

export function decideDispatch(
  mode: SendMode,
  phone: string,
  allowlist: string[]
): DispatchDecision {
  if (mode === "dry_run") return { action: "dry_run" };
  if (mode === "allowlist") {
    const normalized = normalizePhone(phone);
    return allowlist.map(normalizePhone).includes(normalized)
      ? { action: "send" }
      : { action: "blocked_by_allowlist" };
  }
  return { action: "send" };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/notifications/dispatch-policy.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/types.ts src/lib/notifications/dispatch-policy.ts src/lib/notifications/dispatch-policy.test.ts
git commit -m "feat: 발송 직전 재검증·발송 모드 게이트 (순수 함수)"
```

---

### Task 10: Provider 인터페이스와 SOLAPI·Mock 구현

TRD §16. SDK 응답 필드는 방어적으로 매핑한다.

**Files:**
- Create: `src/lib/notifications/providers/message-provider.ts`
- Create: `src/lib/notifications/providers/solapi-provider.ts`
- Create: `src/lib/notifications/providers/mock-provider.ts`
- Test: `src/lib/notifications/providers/mock-provider.test.ts`

- [ ] **Step 1: 인터페이스 작성** (`message-provider.ts`)

```ts
// 메시지 Provider 인터페이스 (TRD §16.1) — 향후 알림톡 채널 추가 시 확장 지점

export interface ProviderSendResult {
  ok: boolean;
  providerMessageId?: string;
  providerGroupId?: string;
  messageType?: string; // Provider가 판별한 최종 SMS/LMS
  errorCode?: string;
  errorMessage?: string;
}

export interface ProviderStatusResult {
  status: "pending" | "delivered" | "failed" | "unknown";
  errorCode?: string;
}

export interface MessageProvider {
  sendSms(input: { to: string; from: string; text: string }): Promise<ProviderSendResult>;
  getMessageStatus(providerMessageId: string): Promise<ProviderStatusResult>;
  getBalance(): Promise<number>;
}
```

- [ ] **Step 2: Mock Provider의 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { createMockProvider } from "./mock-provider";

describe("createMockProvider", () => {
  it("성공 모드: 보낸 메시지를 기록하고 성공을 돌려준다", async () => {
    const mock = createMockProvider();
    const r = await mock.sendSms({ to: "01012345678", from: "0311234567", text: "안녕" });
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toBeTruthy();
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0].to).toBe("01012345678");
  });
  it("실패 모드: errorCode를 돌려준다", async () => {
    const mock = createMockProvider({ failWith: "InsufficientBalance" });
    const r = await mock.sendSms({ to: "01012345678", from: "0311234567", text: "안녕" });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("InsufficientBalance");
    expect(mock.sent).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/notifications/providers/mock-provider.test.ts`
Expected: FAIL — `Cannot find module './mock-provider'`

- [ ] **Step 4: Mock 구현** (`mock-provider.ts`)

```ts
// 테스트·개발용 Mock Provider — 외부 호출 없이 발송 흐름을 검증한다
import type { MessageProvider, ProviderSendResult } from "./message-provider";

export interface MockProvider extends MessageProvider {
  sent: Array<{ to: string; from: string; text: string }>;
}

export function createMockProvider(opts: { failWith?: string } = {}): MockProvider {
  const sent: MockProvider["sent"] = [];
  let seq = 0;
  return {
    sent,
    async sendSms(input): Promise<ProviderSendResult> {
      if (opts.failWith) {
        return { ok: false, errorCode: opts.failWith, errorMessage: "mock failure" };
      }
      sent.push(input);
      seq += 1;
      return {
        ok: true,
        providerMessageId: `MOCK-${seq}`,
        providerGroupId: "MOCK-GROUP-1",
        messageType: input.text.length > 45 ? "LMS" : "SMS",
      };
    },
    async getMessageStatus() {
      return { status: "delivered" as const };
    },
    async getBalance() {
      return 100000;
    },
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/notifications/providers/mock-provider.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: SOLAPI 구현** (`solapi-provider.ts`) — 응답 필드는 방어적 매핑. Allowlist 첫 실발송 때 `provider_raw_last_event`에 저장된 실제 응답으로 매핑을 보정한다.

```ts
// SOLAPI Provider (TRD §16) — solapi SDK 5.5.1
import { SolapiMessageService } from "solapi";
import type { MessageProvider, ProviderSendResult } from "./message-provider";

export function createSolapiProvider(): MessageProvider {
  const svc = new SolapiMessageService(
    process.env.SOLAPI_API_KEY!,
    process.env.SOLAPI_API_SECRET!
  );
  return {
    async sendSms({ to, from, text }): Promise<ProviderSendResult> {
      try {
        // SDK가 본문 길이에 따라 SMS/LMS를 자동 판별한다
        const res: any = await svc.send({ to, from, text });
        const first = res?.messageList?.[0] ?? {};
        return {
          ok: true,
          providerGroupId: res?.groupInfo?.groupId ?? res?.groupId,
          providerMessageId: first.messageId,
          messageType: first.type,
        };
      } catch (e: any) {
        return {
          ok: false,
          errorCode: e?.errorCode ?? e?.name ?? "SEND_ERROR",
          errorMessage: e?.errorMessage ?? e?.message ?? String(e),
        };
      }
    },
    async getMessageStatus(providerMessageId) {
      try {
        const res: any = await svc.getMessages({ messageId: providerMessageId });
        const msg = res?.messageList?.[0] ?? res?.[0];
        const code: string | undefined = msg?.statusCode;
        if (!code) return { status: "unknown" };
        if (code === "4000") return { status: "delivered" };
        if (code.startsWith("2") || code.startsWith("3")) return { status: "pending" };
        return { status: "failed", errorCode: code };
      } catch {
        return { status: "unknown" };
      }
    },
    async getBalance() {
      const res: any = await svc.getBalance();
      return Number(res?.balance ?? 0);
    },
  };
}
```

- [ ] **Step 7: 전체 테스트 통과 확인**

Run: `npm test`
Expected: PASS (지금까지의 테스트 전부)

- [ ] **Step 8: Commit**

```bash
git add src/lib/notifications/providers/
git commit -m "feat: MessageProvider 인터페이스와 SOLAPI·Mock 구현"
```

---

### Task 11: Dispatcher — 발송 파이프라인 오케스트레이션

Claim → 재검증 → 렌더 → 모드 게이트 → 발송 → 상태 기록. Supabase 클라이언트와 Provider를 주입받아 dry_run 통합 테스트(Task 13)로 검증한다.

**Files:**
- Create: `src/lib/notifications/dispatcher.ts`

- [ ] **Step 1: 구현**

```ts
// Notification Dispatcher (TRD §14~§16, §19)
// Cron API가 호출한다. 외부 API는 DB 트랜잭션 밖에서 실행.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { estimateCost, smsType } from "./cost";
import { decideDispatch, revalidateJob } from "./dispatch-policy";
import { isValidMobile, normalizePhone } from "./phone";
import type { MessageProvider } from "./providers/message-provider";
import { renderTemplate } from "./template-renderer";
import type { JobRow, SendMode } from "./types";
import { formatKoreanDate } from "../utils";

const RETRY_DELAY_MINUTES = [5, 30]; // 1회차 5분, 2회차 30분, 3회차 최종 실패 (TRD §19)
const MAX_ATTEMPTS = 3;

const maskPhoneForLog = (p: string) => {
  const d = normalizePhone(p);
  return d.slice(0, 3) + "****" + d.slice(-4);
};
const hashPhone = (p: string) =>
  createHash("sha256").update(normalizePhone(p)).digest("hex");

export interface DispatchSummary {
  claimed: number;
  sent: number;
  dryRun: number;
  skipped: number;
  failed: number;
}

export async function dispatchDueJobs(opts: {
  service: SupabaseClient;
  provider: MessageProvider;
  mode: SendMode;
  allowlist: string[];
  workerId: string;
  limit?: number;
}): Promise<DispatchSummary> {
  const { service, provider, mode, allowlist, workerId, limit = 20 } = opts;
  const summary: DispatchSummary = { claimed: 0, sent: 0, dryRun: 0, skipped: 0, failed: 0 };

  const { data: jobs, error } = await service.rpc("claim_due_notification_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (error) throw new Error(`claim 실패: ${error.message}`);
  summary.claimed = jobs?.length ?? 0;

  for (const job of (jobs ?? []) as JobRow[]) {
    try {
      await processJob(service, provider, mode, allowlist, job, summary);
    } catch (e) {
      // 한 건의 예외가 배치 전체를 멈추지 않게 한다 — 재시도 예약
      await scheduleRetryOrFail(service, job, "INTERNAL_ERROR", String(e), summary);
    }
  }
  return summary;
}

async function processJob(
  service: SupabaseClient,
  provider: MessageProvider,
  mode: SendMode,
  allowlist: string[],
  job: JobRow,
  summary: DispatchSummary
) {
  // 1) 최신 예약·설정·규칙·템플릿 로드
  const [{ data: res }, { data: settings }, { data: pref }] = await Promise.all([
    service.from("reservations")
      .select("id, guest_name, guest_phone, visit_start_date, reservation_status, display_no, pax")
      .eq("id", job.reservation_id).single(),
    service.from("business_notification_settings")
      .select("*").eq("business_id", job.business_id).single(),
    service.from("reservation_notification_preferences")
      .select("enabled").eq("reservation_id", job.reservation_id).maybeSingle(),
  ]);
  const { data: rule } = job.rule_id
    ? await service.from("notification_rules").select("sms_template_id").eq("id", job.rule_id).single()
    : { data: null };
  const templateId = rule?.sms_template_id ?? null;
  const { data: tpl } = templateId
    ? await service.from("message_templates").select("*").eq("id", templateId).single()
    : { data: null };

  // 2) 발송 직전 재검증 (TRD §15)
  const { data: succeeded } = await service.from("notification_jobs")
    .select("id").eq("reservation_id", job.reservation_id).eq("stage", job.stage)
    .eq("base_visit_date", job.base_visit_date).eq("status", "success").neq("id", job.id).limit(1);
  const enabled = !!settings?.notification_enabled && (pref === null || pref?.enabled !== false);
  const skip = !res || !tpl
    ? ("notification_disabled" as const)
    : revalidateJob(job, res, enabled, (succeeded?.length ?? 0) > 0);
  if (skip) {
    await service.from("notification_jobs")
      .update({ status: "skipped", cancellation_reason: skip, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    summary.skipped += 1;
    return;
  }

  // 3) 템플릿 치환
  const { data: options } = await service.from("reservation_options")
    .select("option_name").eq("reservation_id", job.reservation_id);
  const { text } = renderTemplate(tpl!.body_text, {
    고객명: res!.guest_name,
    방문일: formatKoreanDate(res!.visit_start_date),
    인원: String(res!.pax ?? ""),
    옵션: (options ?? []).map((o) => o.option_name).join(", "),
    표시번호: res!.display_no,
    사업장명: undefined, // businesses.name은 settings에 없음 — 필요 시 join
    사업장전화: settings!.business_phone ?? undefined,
    사업장주소: settings!.business_address ?? undefined,
  });

  const cost = estimateCost(text, {
    smsCost: Number(settings!.sms_unit_cost),
    lmsCost: Number(settings!.lms_unit_cost),
  });

  // 4) Delivery 생성 (전화번호 원문은 저장하지 않음 — TRD §16.3)
  const { data: delivery, error: dErr } = await service.from("notification_deliveries")
    .insert({
      job_id: job.id,
      template_id: tpl!.id,
      sequence_no: job.attempt_count,
      recipient_masked: maskPhoneForLog(res!.guest_phone),
      recipient_hash: hashPhone(res!.guest_phone),
      content_snapshot: { text, template_version: tpl!.version, sms_type: smsType(text) },
      estimated_cost: cost,
      requested_at: new Date().toISOString(),
    })
    .select("id").single();
  if (dErr) throw new Error(`delivery 생성 실패: ${dErr.message}`);

  // 5) 발송 모드 게이트 (TRD §22)
  const decision = decideDispatch(mode, res!.guest_phone, allowlist);
  if (decision.action === "dry_run" || decision.action === "blocked_by_allowlist") {
    await service.from("notification_deliveries")
      .update({ status: "skipped", last_error_message: decision.action, updated_at: new Date().toISOString() })
      .eq("id", delivery!.id);
    await service.from("notification_jobs")
      .update({ status: "skipped", cancellation_reason: decision.action, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    summary.dryRun += 1;
    return;
  }

  // 6) 외부 발송 (트랜잭션 밖)
  if (!isValidMobile(res!.guest_phone)) throw new Error("unreachable: revalidate에서 걸러짐");
  const result = await provider.sendSms({
    to: normalizePhone(res!.guest_phone),
    from: normalizePhone(settings!.sender_phone ?? process.env.SOLAPI_SENDER_NUMBER ?? ""),
    text,
  });

  if (result.ok) {
    await service.from("notification_deliveries").update({
      status: "sent",
      provider_message_id: result.providerMessageId ?? null,
      provider_group_id: result.providerGroupId ?? null,
      provider_message_type: result.messageType ?? null,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", delivery!.id);
    await service.rpc("recalculate_notification_job_status", { p_job_id: job.id });
    summary.sent += 1;
  } else {
    await service.from("notification_deliveries").update({
      status: "failed",
      last_error_code: result.errorCode ?? null,
      last_error_message: result.errorMessage ?? null,
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", delivery!.id);
    await scheduleRetryOrFail(service, job, result.errorCode ?? "SEND_ERROR", result.errorMessage ?? "", summary);
  }
}

// 요청 자체 실패의 재시도 (TRD §19): 5분 → 30분 → 최종 실패
async function scheduleRetryOrFail(
  service: SupabaseClient,
  job: JobRow,
  code: string,
  message: string,
  summary: DispatchSummary
) {
  if (job.attempt_count < MAX_ATTEMPTS) {
    const delay = RETRY_DELAY_MINUTES[job.attempt_count - 1] ?? 30;
    await service.from("notification_jobs").update({
      status: "scheduled",
      next_retry_at: new Date(Date.now() + delay * 60_000).toISOString(),
      locked_at: null, locked_by: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
  } else {
    await service.from("notification_jobs").update({
      status: "failed",
      cancellation_reason: `${code}: ${message}`.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    summary.failed += 1;
  }
}
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications/dispatcher.ts
git commit -m "feat: 발송 파이프라인 Dispatcher (claim→재검증→렌더→모드 게이트→발송→기록)"
```

---

### Task 12: Cron·Webhook API 라우트

TRD §13·§17·§20. Cron 인증은 `Authorization: Bearer CRON_SECRET`, Webhook 인증은 `X-SOLAPI-SECRET` 헤더 비교.

**Files:**
- Create: `src/lib/security/cron-auth.ts`
- Create: `src/app/api/cron/notifications/dispatch/route.ts`
- Create: `src/app/api/cron/notifications/recover-locks/route.ts`
- Create: `src/app/api/cron/notifications/reconcile/route.ts`
- Create: `src/app/api/webhooks/solapi/route.ts`

- [ ] **Step 1: Cron 인증 헬퍼** (`cron-auth.ts`)

```ts
// Cron API 보호 (TRD §13): Supabase Cron → Vercel 호출 시 Bearer 토큰 검증
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
```

- [ ] **Step 2: dispatch 라우트**

```ts
// 메시지 발송 Cron (5분 주기) — TRD §13, §14
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/security/cron-auth";
import { dispatchDueJobs } from "@/lib/notifications/dispatcher";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";
import type { SendMode } from "@/lib/notifications/types";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const mode = (process.env.NOTIFICATION_SEND_MODE ?? "dry_run") as SendMode;
  const allowlist = (process.env.NOTIFICATION_TEST_PHONE_ALLOWLIST ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  const summary = await dispatchDueJobs({
    service: createServiceClient(),
    provider: createSolapiProvider(),
    mode,
    allowlist,
    workerId: `vercel-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`,
  });
  return NextResponse.json({ ok: true, mode, ...summary });
}
```

- [ ] **Step 3: recover-locks 라우트**

```ts
// 장시간 잠금 복구 Cron (15분 주기) — TRD §19
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/security/cron-auth";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = createServiceClient();
  const { data, error } = await service.rpc("recover_stuck_notification_jobs");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, recovered: data });
}
```

- [ ] **Step 4: reconcile 라우트** (sent 상태로 30분 이상 머문 Delivery를 상태 조회로 확정)

```ts
// Provider 상태 대조 Cron (30분 주기) — TRD §13, §18
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/security/cron-auth";
import { createSolapiProvider } from "@/lib/notifications/providers/solapi-provider";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = createServiceClient();
  const provider = createSolapiProvider();
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();

  const { data: pending } = await service.from("notification_deliveries")
    .select("id, job_id, provider_message_id")
    .in("status", ["sending", "sent"])
    .not("provider_message_id", "is", null)
    .lt("sent_at", cutoff)
    .limit(50);

  let updated = 0;
  for (const d of pending ?? []) {
    const s = await provider.getMessageStatus(d.provider_message_id!);
    if (s.status === "delivered") {
      await service.from("notification_deliveries")
        .update({ status: "delivered", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", d.id);
    } else if (s.status === "failed") {
      await service.from("notification_deliveries")
        .update({ status: "failed", last_error_code: s.errorCode ?? null, failed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", d.id);
    } else {
      continue;
    }
    await service.rpc("recalculate_notification_job_status", { p_job_id: d.job_id });
    updated += 1;
  }
  return NextResponse.json({ ok: true, checked: pending?.length ?? 0, updated });
}
```

- [ ] **Step 5: SOLAPI Webhook 라우트** (헤더 검증 → Zod → 중복 차단 → Delivery 갱신 → 상태 재계산)

```ts
// SOLAPI 메시지 리포트 Webhook (TRD §17)
// 검증: X-SOLAPI-EVENT-NAME + X-SOLAPI-SECRET 고정 시크릿 비교 (HMAC 아님)
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const reportItem = z.object({
  messageId: z.string(),
  statusCode: z.string(),
  type: z.string().optional(),
  dateReceived: z.string().optional(),
}).passthrough();
const reportSchema = z.array(reportItem).min(1).max(1000);

export async function POST(req: Request) {
  const secret = process.env.SOLAPI_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-solapi-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const eventName = req.headers.get("x-solapi-event-name") ?? "UNKNOWN";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const service = createServiceClient();
  for (const msg of parsed.data) {
    const eventKey = createHash("sha256")
      .update(`${msg.messageId}:${msg.statusCode}:${msg.dateReceived ?? ""}`)
      .digest("hex");

    // 중복 이벤트 차단 (event_key UNIQUE) — 이미 처리한 이벤트는 조용히 건너뜀
    const { error: insErr } = await service.from("provider_webhook_events").insert({
      event_key: eventKey,
      event_type: eventName,
      provider_message_id: msg.messageId,
      payload: msg,
    });
    if (insErr) continue; // 23505 duplicate 포함

    const isSuccess = msg.statusCode === "4000";
    const { data: delivery } = await service.from("notification_deliveries")
      .select("id, job_id")
      .eq("provider_message_id", msg.messageId)
      .maybeSingle();
    if (!delivery) continue; // 알 수 없는 메시지 — 이벤트만 보관

    await service.from("notification_deliveries").update(
      isSuccess
        ? { status: "delivered", delivered_at: new Date().toISOString(),
            provider_raw_last_event: msg, updated_at: new Date().toISOString() }
        : { status: "failed", last_error_code: msg.statusCode,
            failed_at: new Date().toISOString(),
            provider_raw_last_event: msg, updated_at: new Date().toISOString() }
    ).eq("id", delivery.id);

    await service.rpc("recalculate_notification_job_status", { p_job_id: delivery.job_id });
    await service.from("provider_webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("event_key", eventKey);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 7: Commit**

```bash
git add src/lib/security/cron-auth.ts src/app/api/cron/ src/app/api/webhooks/
git commit -m "feat: 발송 Cron 3종·SOLAPI Webhook API 라우트"
```

---

### Task 13: 환경변수 정리와 dry_run 통합 검증

**Files:**
- Modify: `.env.example`
- (로컬) `.env.local` — 커밋 금지

- [ ] **Step 1: .env.example에 발송 시스템 변수 추가** (기존 내용 아래에 덧붙임)

```bash
# ---- 문자 발송 시스템 (TRD v3.1 §22) ----
CRON_SECRET=
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER_NUMBER=
SOLAPI_WEBHOOK_SECRET=
# dry_run(외부 발송 없음) | allowlist(테스트 번호만) | live(운영)
NOTIFICATION_SEND_MODE=dry_run
NOTIFICATION_TEST_PHONE_ALLOWLIST=
```

- [ ] **Step 2: .env.local 구성** (사람이 수행 — Supabase 키 + CRON_SECRET 임의값, SOLAPI 키는 dry_run에선 불필요)

- [ ] **Step 3: 테스트 데이터 준비** (SQL Editor)

```sql
-- 자동 안내 켜기 + 규칙 활성화
update business_notification_settings set notification_enabled = true;
update notification_rules set enabled = true;

-- 방문 8일 뒤 테스트 예약 → 트리거가 4개 Job을 만들어야 함
insert into reservations (business_id, display_no, source, guest_name, guest_phone,
                          visit_start_date, pax, paid_amount, reservation_status)
select id, 'TEST-DRYRUN-001', 'text_inquiry', '테스트고객', '010-1234-5678',
       current_date + 8, 4, 100000, 'confirmed'
from businesses limit 1;

select stage, status, scheduled_at from notification_jobs
where reservation_id = (select id from reservations where display_no = 'TEST-DRYRUN-001')
order by scheduled_at;
```
Expected: `d_7`, `d_3`, `d_1`, `d_day` 4행, 모두 `scheduled`

- [ ] **Step 4: 한 건을 지금 발송 대상으로 만들기** (SQL Editor)

```sql
update notification_jobs set scheduled_at = now() - interval '1 minute'
where stage = 'd_7'
  and reservation_id = (select id from reservations where display_no = 'TEST-DRYRUN-001');
```

- [ ] **Step 5: 로컬 서버 켜고 dispatch 호출**

```bash
npm run dev
# 별도 터미널에서 (CRON_SECRET은 .env.local 값)
curl -s -X POST http://localhost:3000/api/cron/notifications/dispatch \
  -H "Authorization: Bearer <CRON_SECRET>"
```
Expected: `{"ok":true,"mode":"dry_run","claimed":1,"sent":0,"dryRun":1,"skipped":0,"failed":0}`

- [ ] **Step 6: 결과 확인** (SQL Editor)

```sql
select j.stage, j.status as job_status, d.status as delivery_status,
       d.content_snapshot->>'text' as rendered, d.estimated_cost
from notification_jobs j join notification_deliveries d on d.job_id = j.id
where j.reservation_id = (select id from reservations where display_no = 'TEST-DRYRUN-001');
```
Expected: 1행 — job `skipped`(사유 dry_run), delivery `skipped`, `rendered`에 변수가 치환된 실제 문구, `estimated_cost` 18 또는 45

- [ ] **Step 7: 테스트 데이터 정리** (SQL Editor)

```sql
delete from reservations where display_no = 'TEST-DRYRUN-001';
update business_notification_settings set notification_enabled = false;
update notification_rules set enabled = false;
```

- [ ] **Step 8: Commit**

```bash
git add .env.example
git commit -m "feat: 발송 시스템 환경변수 정리 (dry_run 통합 검증 완료)"
```

---

## 완료 기준 (이 계획의 Definition of Done)

- `npm test` 전체 통과 (phone·cost·renderer·policy·mock provider)
- `npx tsc --noEmit` 오류 없음
- 마이그레이션 0005~0007, 0009 적용됨 (0008 Cron은 배포 후)
- 테스트 예약 생성 → 트리거가 4개 Job 생성 → dispatch가 dry_run으로 처리하고 치환 문구·비용이 기록됨
- 예약 취소 시 미발송 Job이 `cancelled_by_reservation`으로 전환됨 (Task 13 변형으로 확인 가능)

## 이 계획이 다루지 않는 것 (Plan 2로 이월)

- 관리자 UI 6페이지 (자동안내설정·메시지 템플릿·솔라피 설정·발송 일정·발송 이력·실패 관리)와 그 API (템플릿 CRUD, 즉시 발송·재발송·제외 액션)
- Vercel 배포·0008 Cron 등록·allowlist 실발송 검증·SOLAPI 응답 필드 보정 (배포 단계)
- 모니터링·경고 (TRD §25)
