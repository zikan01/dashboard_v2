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
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates m
    WHERE m.business_id = b.id AND m.channel = 'sms' AND m.purpose = t.purpose
  )
  RETURNING id, business_id, purpose
)
INSERT INTO notification_rules (business_id, stage, offset_days, send_time, sms_template_id, enabled)
SELECT tpl.business_id, tpl.purpose,
  CASE tpl.purpose WHEN 'd_7' THEN 7 WHEN 'd_3' THEN 3 WHEN 'd_1' THEN 1 ELSE 0 END,
  CASE tpl.purpose WHEN 'd_1' THEN time '15:00' WHEN 'd_day' THEN time '08:00' ELSE time '10:00' END,
  tpl.id, false
FROM tpl
ON CONFLICT (business_id, stage) DO NOTHING;
