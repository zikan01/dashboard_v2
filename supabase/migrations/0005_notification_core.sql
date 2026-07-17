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
