"use client";

// 초대받은 직원의 비밀번호 설정 페이지 — 초대 메일 링크로 진입 (세션은 링크로 자동 수립)

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function SetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 초대 링크의 코드 교환이 끝날 때까지 잠시 대기 후 세션 확인
    const check = async () => {
      // 초대/매직링크가 세션 토큰을 URL 해시로 전달하는 경우(implicit flow) 직접 세션 수립
      // — @supabase/ssr의 PKCE 클라이언트는 해시 토큰을 자동 처리하지 않는다
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: sessionErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!sessionErr) {
          // 토큰이 남지 않도록 URL에서 해시 제거
          window.history.replaceState(null, "", window.location.pathname);
          setHasSession(true);
          return;
        }
      }
      for (let i = 0; i < 6; i++) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          setHasSession(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      setHasSession(false);
    };
    check();
  }, [supabase]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(`비밀번호 설정에 실패했습니다: ${err.message}`);
      return;
    }
    // 전체 새로고침으로 세션·프로필을 다시 로드하며 대시보드 진입
    window.location.assign("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-900 text-xl font-bold text-white">
            고
          </div>
          <div className="text-center">
            <div className="text-lg font-bold">비밀번호 설정</div>
            <div className="mt-0.5 text-xs text-muted">
              고마워할매 예약 운영 대시보드에 오신 것을 환영해요
            </div>
          </div>
        </div>
        <Card className="p-6">
          {hasSession === null && (
            <div className="py-2 text-center text-[13px] text-muted">
              초대 링크 확인 중…
            </div>
          )}
          {hasSession === false && (
            <div className="py-2 text-center text-[13px] text-muted">
              초대 링크가 만료되었거나 잘못되었습니다. 관리자에게 재초대를 요청해
              주세요.
            </div>
          )}
          {hasSession && (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-[#55514a]">
                  새 비밀번호 (8자 이상)
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-[#55514a]">
                  비밀번호 확인
                </label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {error && <div className="text-[12px] text-[#c0392b]">{error}</div>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "설정 중…" : "비밀번호 설정하고 시작하기"}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
