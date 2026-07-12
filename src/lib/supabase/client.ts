// 브라우저용 Supabase 클라이언트 (anon key — RLS 적용, 조회 + 허용된 쓰기만 가능)
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
