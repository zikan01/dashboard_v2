-- 0008: Cron 등록 (TRD v3.1 §13)
-- ⚠️ 실행 전 치환: {{APP_BASE_URL}} → 배포 URL, {{CRON_SECRET}} → 환경변수와 같은 값
--    (Secret을 git에 커밋하지 않기 위해 실행 시점에 채운다)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 메시지 발송: 5분마다
SELECT cron.schedule('notification-dispatch', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://dashboardv2-kappa.vercel.app/api/cron/notifications/dispatch',
    headers := '{"Authorization": "Bearer 3afa2f6bfcae6d86191974fa84228c00dc52de43ab7a80d9", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- 잠금 복구: 15분마다
SELECT cron.schedule('notification-recover-locks', '*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://dashboardv2-kappa.vercel.app/api/cron/notifications/recover-locks',
    headers := '{"Authorization": "Bearer 3afa2f6bfcae6d86191974fa84228c00dc52de43ab7a80d9", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- Provider 상태 대조: 30분마다
SELECT cron.schedule('notification-reconcile', '*/30 * * * *', $$
  SELECT net.http_post(
    url := 'https://dashboardv2-kappa.vercel.app/api/cron/notifications/reconcile',
    headers := '{"Authorization": "Bearer 3afa2f6bfcae6d86191974fa84228c00dc52de43ab7a80d9", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
