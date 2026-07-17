// Cron API 보호 (TRD §13): Supabase Cron → Vercel 호출 시 Bearer 토큰 검증
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
