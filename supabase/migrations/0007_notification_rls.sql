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
