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
  IF v_phone !~ '^01[016789][0-9]{7,8}$' THEN RETURN; END IF;

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
  -- 시도 소진(3회 이상) 작업은 실패로 확정
  UPDATE notification_jobs j
  SET status = 'failed',
      cancellation_reason = coalesce(cancellation_reason, '잠금 복구: 재시도 상한 초과'),
      locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE j.status = 'processing'
    AND j.locked_at < now() - interval '15 minutes'
    AND j.attempt_count >= 3
    AND NOT EXISTS (
      SELECT 1 FROM notification_deliveries d
      WHERE d.job_id = j.id AND d.provider_message_id IS NOT NULL
    );

  UPDATE notification_jobs j
  SET status = 'scheduled', locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE j.status = 'processing'
    AND j.locked_at < now() - interval '15 minutes'
    AND j.attempt_count < 3
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
