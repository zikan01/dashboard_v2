// 서버(Route Handler) 전용 Supabase 유틸
// - createServerSupabase: 쿠키 세션으로 "누가 요청했는지" 확인 (RLS 적용)
// - createServiceClient: Service Role 키 — RLS 우회, 예약 사실정보 쓰기는 반드시 이쪽 (TRD §3.3)

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServerSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Route Handler 밖에서 호출되면 set 불가 — 무시
          }
        },
      },
    }
  );
}

export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export interface RequestContext {
  userId: string;
  businessId: string;
  name: string;
  role: "owner" | "staff";
}

// 공용 가드: 로그인 + 활성 프로필 확인, role 지정 시 해당 역할만 허용
export async function requireUser(
  role?: "owner"
): Promise<RequestContext | null> {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient();
  const { data: profile } = await service
    .from("profiles")
    .select("business_id, name, role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.status !== "active") return null;
  if (role === "owner" && profile.role !== "owner") return null;

  return {
    userId: user.id,
    businessId: profile.business_id,
    name: profile.name,
    role: profile.role,
  };
}
