"use client";

// Supabase Auth 이메일/비밀번호 로그인 — 역할(대표/직원)은 profiles 테이블에서 판별

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const { user, ready, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 이미 로그인돼 있으면 대시보드로
  useEffect(() => {
    if (ready && user) router.replace("/");
  }, [ready, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await login(email.trim(), password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "로그인에 실패했습니다.");
      return;
    }
    router.replace("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-900 text-xl font-bold text-white">
            고
          </div>
          <div className="text-center">
            <div className="text-lg font-bold">고마워할매 예약 운영</div>
            <div className="mt-0.5 text-xs text-muted">
              관리자·직원 계정으로 로그인하세요
            </div>
          </div>
        </div>
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-[#55514a]">
                이메일
              </label>
              <Input
                type="email"
                placeholder="owner@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-[#55514a]">
                비밀번호
              </label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && <div className="text-[12px] text-[#c0392b]">{error}</div>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "로그인 중…" : "로그인"}
            </Button>
          </form>
          <div className="mt-4 rounded-lg bg-cream px-3 py-2.5 text-[11.5px] text-muted">
            직원 계정은 대표(관리자)가 직원 관리 화면에서 초대합니다. 비활성화된
            계정은 로그인할 수 없습니다.
          </div>
        </Card>
      </div>
    </div>
  );
}
