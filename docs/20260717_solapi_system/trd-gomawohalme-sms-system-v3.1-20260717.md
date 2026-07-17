# 고마워할매 문자 발송 시스템 TRD v3.1

> 문서 유형: Technical Requirements Document  
> 작성일: 2026-07-17  
> 대상 저장소: `zikan01/dashboard_v2`  
> 기준 문서: PRD v3.1, FRD v3.1  
> 기준 시간대: `Asia/Seoul`

---

## 0. 문서 목적

본 문서는 솔라피(SOLAPI) 기반 문자 발송 시스템의 데이터베이스, 서버, 외부 API, 스케줄러, 보안과 배포 구조를 정의한다.

- D-7·D-3·D-1·당일 문자 자동 안내
- 발송 일정·결과·비용
- 실패 관리와 재시도

v3.0에서 정의했던 알림톡, 이메일, 사진 Storage, 설문, 고객 공개 API는 본 버전 범위에서 제외한다.

---

## 1. 담당 범위 (협업 경계)

| 구분 | 담당 |
|---|---|
| 동료 | `reservations` 테이블과 예약 CRUD, 대시보드 홈·예약 목록·예약 상세 화면 |
| 본 문서 | 발송 관련 신규 테이블·함수·API·Cron·Webhook과 6개 화면 |

- 발송 시스템은 `reservations`를 **읽기 전용**으로 참조한다. UPDATE·INSERT하지 않는다.
- 예약 변경 감지용 Trigger(11장)는 `reservations` 테이블에 걸리므로 생성 전 동료와 협의한다.
- `reservations`에 컬럼 추가가 필요한 경우(7장) 동료와 협의 후 반영한다.

---

## 2. 현재 프로젝트 기준

현재 구조:

- Next.js 14 App Router
- React 18
- TypeScript
- Tailwind CSS
- Supabase Auth·PostgreSQL
- Supabase JavaScript SDK
- Next.js Route Handlers
- Zod
- React Hook Form
- SheetJS
- Vercel 배포

v3.1에서는 Prisma를 도입하지 않는다. 기존 Supabase SDK, SQL Migration, PostgreSQL RPC와 Route Handler 구조를 유지한다.

주요 쓰기 작업은 서버 API에서 Supabase Service Role로 수행한다. Service Role과 외부 Provider Secret은 클라이언트에 노출하지 않는다.

---

## 3. 잠긴 기술 결정

| 구분 | 기술 |
|---|---|
| 프론트엔드 | Next.js 14, React 18, TypeScript |
| UI | Tailwind CSS, 기존 컴포넌트 |
| 백엔드 | Next.js Route Handlers |
| DB | Supabase PostgreSQL |
| 인증 | Supabase Auth |
| 권한 | RLS + 서버 권한 검증 |
| 메시지 | SOLAPI (SMS·LMS) |
| 스케줄러 | Supabase Cron |
| 배포 | Vercel |

---

## 4. 아키텍처

```text
관리자·직원 웹
  ├─ 설정/템플릿/발송 UI
  └─ Supabase Auth
          │
          ▼
Next.js Route Handlers
  ├─ 설정·템플릿 API
  ├─ Notification Dispatcher
  ├─ Cron API
  └─ SOLAPI Webhook
      │        │
      ▼        ▼
Supabase    SOLAPI
DB/Auth/    SMS/LMS
Cron
```

---

## 5. 권장 파일 구조

```text
src/
├─ app/
│  ├─ (dashboard)/
│  │  ├─ notifications/{schedule,history,failures}/
│  │  └─ settings/{notifications,templates,providers/solapi}/
│  └─ api/
│     ├─ notifications/
│     ├─ settings/
│     ├─ templates/
│     ├─ cron/
│     └─ webhooks/
├─ lib/
│  ├─ notifications/
│  │  ├─ dispatcher.ts
│  │  ├─ scheduler.ts
│  │  ├─ template-renderer.ts
│  │  ├─ cost.ts
│  │  └─ providers/{message-provider,solapi-provider}.ts
│  └─ security/{webhook,rate-limit}.ts
└─ components/notifications/
```

동료 담당 화면(대시보드 홈, 예약 목록·상세) 디렉터리는 수정하지 않는다.

---

## 6. 추가 패키지

```json
{
  "dependencies": {
    "solapi": "5.5.1"
  },
  "devDependencies": {
    "vitest": "최신 안정 버전 고정",
    "@playwright/test": "최신 안정 버전 고정"
  }
}
```

설치 후 `package-lock.json`을 커밋하여 버전을 고정한다.

---

## 7. 상태값

### 단계

```text
d_7
d_3
d_1
d_day
manual
```

### 발송 작업

```text
scheduled
processing
success
failed
skipped
cancelled_by_change
cancelled_by_reservation
cancelled_by_admin
```

### Delivery

```text
pending
queued
sending
sent
delivered
failed
skipped
cancelled
```

---

## 8. 기존 테이블 확인 결과와 변경

`supabase/migrations/0001_init.sql` 확인 결과 (2026-07-17):

- `reservation_status`는 CHECK 제약으로 `confirmed`, `changed`, `cancelled` 3개 값만 허용한다.
  **발송 대상 = `confirmed`, `changed` / 발송 중단 = `cancelled`.**
- `guest_phone text NOT NULL` — 컬럼 존재. 하이픈 유무 등 형식은 발송 직전 정규화로 흡수한다.
- 방문 시간 컬럼은 없다. 아래 `visit_start_time` 추가가 실제로 필요하다.
- 옵션은 `reservation_options(option_name, quantity)`에서 조회한다 (템플릿 변수 치환 시 조인).
- `profiles.role`은 `owner`(대표), `staff`(직원)이다.
- `businesses(id)`, `profiles(id)` 테이블이 존재하므로 신규 테이블의 FK 참조가 유효하다.

변경:

```sql
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS visit_start_time time;
```

`visit_start_time`은 템플릿 변수(방문 시간)에 사용한다. `reservations` 변경이므로 동료와 협의 후 반영한다.
협의 전까지는 문자에 방문일(날짜)만 안내한다.

자동 발송 시 `guest_phone`, `visit_start_date`, `visit_start_time`, `reservation_status`는 Supabase 값을 기준으로 한다.

---

## 9. 신규 테이블

### 9.1 사업장 설정

```sql
CREATE TABLE business_notification_settings (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  sender_phone text,
  business_phone text,
  business_address text,
  notification_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

API Key와 Secret은 DB에 저장하지 않는다.

### 9.2 메시지 템플릿

```sql
CREATE TABLE message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  purpose text NOT NULL CHECK (
    purpose IN ('d_7','d_3','d_1','d_day','manual')
  ),
  body_text text NOT NULL,
  variable_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id),
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

`channel`은 향후 알림톡 등 채널 추가를 위한 확장 지점이며 v3.1에서는 `sms`만 허용한다.

### 9.3 자동 안내 규칙

```sql
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
```

### 9.4 예약별 설정

```sql
CREATE TABLE reservation_notification_preferences (
  reservation_id uuid PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  exclusion_reason text,
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

예약별 단계 덮어쓰기는 v3.1 범위에서 제외한다. 일회성 시각 변경·제외는 `notification_jobs`를 직접 수정한다.

### 9.5 발송 작업

```sql
CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES notification_rules(id),
  stage text NOT NULL CHECK (
    stage IN ('d_7','d_3','d_1','d_day','manual')
  ),
  purpose text NOT NULL DEFAULT 'reservation_notice',
  base_visit_date date,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (
    status IN (
      'scheduled','processing','success','failed','skipped',
      'cancelled_by_change','cancelled_by_reservation',
      'cancelled_by_admin'
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
```

전화번호 원문은 `payload_snapshot`에 넣지 않는다.

### 9.6 Delivery

```sql
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  provider text NOT NULL DEFAULT 'solapi' CHECK (provider IN ('solapi')),
  sequence_no integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending','queued','sending','sent','delivered',
      'failed','skipped','cancelled'
    )
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
```

`provider_message_type`에 SOLAPI가 판별한 최종 SMS·LMS 유형을 저장한다.

### 9.7 Webhook 이벤트

```sql
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
```

---

## 10. 인덱스

```sql
CREATE INDEX idx_notification_jobs_due
  ON notification_jobs(status, scheduled_at, next_retry_at);

CREATE INDEX idx_notification_jobs_reservation
  ON notification_jobs(reservation_id, stage, base_visit_date);

CREATE INDEX idx_notification_deliveries_job
  ON notification_deliveries(job_id);

CREATE INDEX idx_notification_deliveries_provider_message
  ON notification_deliveries(provider, provider_message_id);

-- 활성 상태에만 적용하는 부분 유니크 인덱스.
-- 취소·실패 Job은 dedupe_key를 점유하지 않으므로 재생성·재발송이 가능하다.
CREATE UNIQUE INDEX uq_notification_jobs_dedupe_active
  ON notification_jobs(dedupe_key)
  WHERE status IN ('scheduled','processing','success');
```

---

## 11. 중복 방지

자동 작업의 `dedupe_key`:

```text
SHA-256(
  business_id + reservation_id + stage
  + base_visit_date + rule_version
)
```

수동 발송·재발송 작업의 `dedupe_key`:

```text
SHA-256(
  business_id + reservation_id + 'manual'
  + parent_job_id(없으면 신규 UUID)
)
```

수동·재발송은 자동 작업과 키 조합이 다르므로 유니크 제약과 충돌하지 않으며,
새 Job으로 기록하고 `parent_job_id`로 원본과 연결한다.

유니크 제약은 활성 상태(`scheduled`, `processing`, `success`)에만 적용하는
부분 유니크 인덱스로 건다(10장). 취소·실패된 Job은 키를 점유하지 않으므로
취소 일정 재생성과 실패 재발송이 가능하다.

Delivery:

```text
UNIQUE(job_id, channel, sequence_no)
```

---

## 12. 일정 생성과 변경

PostgreSQL 함수:

```text
refresh_reservation_notification_jobs(reservation_id)
```

계산:

```text
scheduled_at =
(visit_start_date - offset_days + send_time)
AT TIME ZONE Asia/Seoul
```

생성 조건:

- `confirmed` 또는 `changed` 예약
- 사업장·예약 자동 안내 활성
- 규칙 활성
- 유효한 전화번호
- 미래 시각

예약 변경:

- 미발송 작업 `cancelled_by_change`
- 새 날짜 작업 생성
- 성공 이력 보존

예약 취소:

- 미발송 작업 `cancelled_by_reservation`

Trigger:

```sql
CREATE TRIGGER trg_reservation_notification_refresh
AFTER INSERT OR UPDATE OF
  visit_start_date,
  reservation_status,
  guest_phone
ON reservations
FOR EACH ROW
EXECUTE FUNCTION trigger_refresh_reservation_notification_jobs();
```

`reservations`에 걸리는 Trigger이므로 생성 전 동료와 협의한다.

---

## 13. Cron

| 작업 | 주기 |
|---|---|
| 메시지 발송 | 5분 |
| 장시간 잠금 복구 | 15분 |
| Provider 상태 대조 | 30분 |

Supabase Cron이 보호된 Next.js API를 호출한다.

```text
Authorization: Bearer {CRON_SECRET}
```

한 번에 최대 20개 Job, 외부 API 동시성 최대 4개로 제한한다.

---

## 14. Job Claim

```sql
CREATE OR REPLACE FUNCTION claim_due_notification_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 20
)
RETURNS SETOF notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
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
```

외부 API 호출은 DB Transaction 밖에서 실행한다.

---

## 15. 발송 직전 재검증

Claim 이후 다음을 다시 확인한다.

- 예약 취소 여부
- 현재 방문일과 `base_visit_date` 일치
- 자동 안내 활성
- 전화번호 유효
- 동일 작업 성공 여부
- 관리자 취소 여부

조건이 맞지 않으면 외부 API를 호출하지 않고 취소·제외 상태로 변경한다.

---

## 16. SOLAPI 처리

### 16.1 Provider 인터페이스

```ts
interface MessageProvider {
  sendSms(input: SendSmsInput): Promise<ProviderSendResult>;
  getMessageStatus(id: string): Promise<ProviderDeliveryResult>;
  getBalance(): Promise<ProviderBalance>;
}
```

향후 알림톡 등 채널 추가 시 인터페이스를 확장한다.

### 16.2 문자 발송

- SMS Delivery 생성
- 최종 치환 본문의 바이트 수에 따라 SMS·LMS 처리
- 최종 유형은 Provider 결과로 저장

### 16.3 전화번호

- 하이픈·공백 제거
- 숫자만 전달
- 국내 휴대전화 검증
- 로그에는 마스킹과 Hash만 저장

---

## 17. SOLAPI Webhook

```text
POST /api/webhooks/solapi
```

등록: SOLAPI 콘솔의 웹훅 메뉴에서 메시지 리포트 이벤트로 등록하고,
등록 시 설정한 시크릿키를 `SOLAPI_WEBHOOK_SECRET` 환경변수로 보관한다.

검증 (SOLAPI는 HMAC 서명이 아닌 고정 시크릿 헤더 비교 방식):

1. `X-SOLAPI-EVENT-NAME` 헤더가 기대한 이벤트(예: `SINGLE-REPORT`)인지 확인
2. `X-SOLAPI-SECRET` 헤더 값이 시크릿키와 일치하는지 비교 (불일치 시 무시)
3. Payload Zod 검증

처리:

1. 위 검증 통과
2. 중복 이벤트 Insert 차단
3. Delivery 갱신 (`statusCode` `4000` = 성공, 그 외 실패 코드 매핑)
4. Job 상태 재계산
5. 2xx 응답

Webhook 이벤트는 Provider message ID, event type과 timestamp를 조합한 Hash를 `event_key`로 사용한다.
발송 요청 시 `customFields`에 내부 delivery ID를 넣어 리포트와 내부 레코드를 매칭한다.

---

## 18. 작업 상태 계산

```text
Delivery 성공(sent 또는 delivered) → success
Delivery 최종 실패 → failed
```

`sent`로 성공 처리된 뒤 Webhook 또는 상태 대조에서 실패가 확인되면
Job을 `failed`로 되돌리고 실패 관리 화면에 노출한다.
상태 반전도 감사 로그에 기록한다.

DB 함수:

```text
recalculate_notification_job_status(job_id)
```

---

## 19. 재시도

API 요청 자체 실패:

| 횟수 | 다음 시도 |
|---:|---:|
| 1 | 5분 후 |
| 2 | 30분 후 |
| 3 | 최종 실패 |

Provider가 요청을 접수한 뒤에는 즉시 재발송하지 않고 Webhook 또는 상태 조회를 기다린다.

15분 이상 `processing`으로 잠긴 작업은 복구한다. Provider ID가 있으면 결과 대조 대상으로 보내고, 없으면 재예약한다.

---

## 20. 주요 API

### 설정

```text
GET /api/settings/notifications
PUT /api/settings/notifications
GET/POST/PUT/DELETE /api/templates
GET /api/settings/providers/solapi/status
POST /api/settings/providers/solapi/test-send
```

### 일정과 이력

```text
GET  /api/notifications/schedule
GET  /api/notifications/history
POST /api/notifications/{jobId}/send-now
POST /api/notifications/{jobId}/retry
POST /api/notifications/{jobId}/exclude
PATCH /api/notifications/{jobId}/schedule
```

### Cron

```text
POST /api/cron/notifications/dispatch
POST /api/cron/notifications/reconcile
POST /api/cron/notifications/recover-locks
```

### Webhook

```text
POST /api/webhooks/solapi
```

---

## 21. RLS와 권한

원칙:

- 같은 사업장만 조회
- 설정·템플릿 변경은 대표 (`profiles.role = 'owner'`)
- 직원(`role = 'staff'`)은 일정·이력 조회
- 외부 발송·재시도·제외는 서버만 (Service Role)

발송 관련 신규 테이블에만 RLS 정책을 추가하며 기존 테이블 정책은 수정하지 않는다.

---

## 22. 환경변수

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
APP_BASE_URL=
CRON_SECRET=

# SOLAPI
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER_NUMBER=
SOLAPI_WEBHOOK_SECRET=

# Feature
FEATURE_SMS_NOTIFICATION=false

# Safety
NOTIFICATION_SEND_MODE=dry_run
NOTIFICATION_TEST_PHONE_ALLOWLIST=
```

발송 모드:

- `dry_run`: 외부 발송 안 함
- `allowlist`: 테스트 연락처만 발송
- `live`: 운영 발송

---

## 23. Secret 관리

다음은 Vercel 서버 환경변수에만 저장한다.

- Supabase Service Role
- SOLAPI API Key·Secret
- SOLAPI Webhook Secret
- Cron Secret

로그에 Secret과 전체 전화번호를 출력하지 않는다.

---

## 24. 감사 로그

범용 `system_audit_logs` 추가를 권장한다.

```sql
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
```

개인정보는 마스킹하여 기록한다. 동료도 감사 로그가 필요할 수 있으므로 테이블 생성 전 협의한다.

---

## 25. 모니터링

- Cron 마지막 성공
- 오늘 예정 작업
- 성공률·최종 실패
- Webhook 지연
- 잠금 복구
- SOLAPI 잔액
- 월간 발송량과 비용

경고:

| 조건 | 등급 |
|---|---|
| Cron 15분 이상 중단 | 긴급 |
| SOLAPI 잔액 부족 | 긴급 |
| 실패율 10% 이상 | 경고 |

---

## 26. Migration 순서

```text
supabase/migrations/
├─ 0004_notification_core.sql
├─ 0005_notification_functions.sql
├─ 0006_notification_rls.sql
├─ 0007_notification_cron.sql
└─ 0008_seed_notification_defaults.sql
```

- 0004: 컬럼·설정·템플릿·규칙·Job·Delivery·Webhook 테이블
- 0005: 일정 생성·Claim·상태 계산·잠금 복구 함수와 Trigger
- 0006: RLS
- 0007: Cron
- 0008: 기본 D-7·D-3·D-1·당일 규칙

현재 저장소에 0001~0003이 사용 중임을 확인했으므로 0004부터 시작한다.
동료가 같은 시기에 Migration을 추가하면 머지 전 번호를 조율한다.

---

## 27. 테스트

### 단위

- 전화번호 정규화·검증
- 시간 계산
- 템플릿 치환
- SMS·LMS 판별과 비용 계산
- 중복 키
- Webhook 검증

### DB 통합

- 신규 예약 4개 작업 생성
- 변경 시 취소·재생성
- 취소 시 중단
- 지난 작업 미생성
- 동시 Claim 중복 방지

### Provider Mock

- 문자 발송 성공·실패
- 잔액·발신번호 오류
- Webhook 중복·순서 역전

### E2E

1. 예약 생성
2. 일정 확인
3. 규칙·템플릿 변경
4. 테스트 발송
5. 실패 재발송
6. 발송 이력 확인

---

## 28. 구현 순서

1. DB·타입·RLS·기본 규칙
2. SOLAPI Provider·Dispatcher·Webhook
3. 설정·템플릿·일정·이력·실패 관리 UI
4. Cron·모니터링
5. Dry Run·Allowlist·파일럿·Live

---

## 29. 최종 기술 확정

1. 기존 Next.js·Supabase SDK 구조를 유지한다.
2. Prisma는 도입하지 않는다.
3. Supabase를 자동 발송 운영 원본으로 사용한다.
4. Job과 Delivery를 분리하고 채널 컬럼을 확장 지점으로 남긴다.
5. SOLAPI를 SMS·LMS Provider로 사용한다.
6. Supabase Cron은 5분 주기로 Dispatcher를 실행한다.
7. Webhook과 상태 대조로 최종 결과를 확정한다.
8. `reservations`는 읽기 전용으로 참조하고 Trigger·컬럼 추가는 동료와 협의한다.
9. 운영 전 Dry Run과 Allowlist를 거친다.
