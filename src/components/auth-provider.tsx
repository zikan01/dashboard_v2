"use client";

// Supabase Auth 세션 관리 — 이메일/비밀번호 로그인 + profiles 테이블의 역할(owner/staff)
// (기존 임시 로그인(admin/admin1234)을 대체)

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { StaffRole } from "@/lib/types";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  roleLabel: string;
  businessId: string;
}

interface LoginResult {
  ok: boolean;
  message?: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "대표 · 관리자",
  staff: "직원 · 열람 전용",
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  // 세션의 사용자 → profiles에서 이름·역할·활성 여부 로드
  const loadProfile = useCallback(
    async (userId: string, email: string): Promise<SessionUser | "inactive" | null> => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("business_id, name, role, status")
        .eq("id", userId)
        .single();
      if (!profile) return null;
      if (profile.status !== "active") return "inactive";
      return {
        id: userId,
        email,
        name: profile.name,
        role: profile.role as StaffRole,
        roleLabel: ROLE_LABEL[profile.role as StaffRole],
        businessId: profile.business_id,
      };
    },
    [supabase]
  );

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authUser) {
        const result = await loadProfile(authUser.id, authUser.email ?? "");
        if (cancelled) return;
        if (result && result !== "inactive") setUser(result);
        else await supabase.auth.signOut();
      }
      setReady(true);
    };
    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setUser(null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.user) {
        return { ok: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." };
      }
      const result = await loadProfile(data.user.id, data.user.email ?? "");
      if (result === "inactive") {
        await supabase.auth.signOut();
        return { ok: false, message: "비활성화된 계정입니다. 관리자에게 문의하세요." };
      }
      if (!result) {
        await supabase.auth.signOut();
        return {
          ok: false,
          message: "계정 정보(프로필)가 등록되지 않았습니다. 관리자에게 문의하세요.",
        };
      }
      setUser(result);
      return { ok: true };
    },
    [supabase, loadProfile]
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth는 AuthProvider 안에서만 사용할 수 있습니다.");
  return ctx;
}
