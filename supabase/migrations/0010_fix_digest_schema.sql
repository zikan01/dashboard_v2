-- 0010: refresh 함수가 pgcrypto의 digest()를 찾지 못하는 문제 수정
-- 적용: Dashboard → SQL Editor 에 전체 붙여넣기 → Run
--
-- 원인: Supabase는 pgcrypto를 extensions 스키마에 설치하는데,
--       0006의 함수는 search_path가 public뿐이라 digest()를 해석하지 못함.
-- 수정: search_path에 extensions 추가 (함수 본문은 0006과 동일).

CREATE OR REPLACE FUNCTION refresh_reservation_notification_jobs(p_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions
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
