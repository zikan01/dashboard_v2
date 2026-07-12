"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isAdminOnlyPath } from "@/lib/auth";
import { useAuth } from "./auth-provider";
import { buttonVariants } from "@/components/ui/button";

// 대시보드 영역 보호: 미로그인이면 /login 으로 리다이렉트
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) return null;

  return <>{children}</>;
}

// 콘텐츠 영역 안에서 직원(staff)의 관리자 전용 화면 접근을 차단
export function RoleGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();

  if (user?.role === "staff" && isAdminOnlyPath(pathname)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="rounded-card border border-border bg-white p-8 text-center shadow-card">
          <div className="text-[15px] font-bold">
            이 작업은 관리자만 할 수 있습니다.
          </div>
          <div className="mt-1.5 text-[12.5px] text-muted">
            직원 계정은 열람과 정산·세금계산서·메모 확인만 가능합니다.
          </div>
          <Link href="/" className={buttonVariants({ className: "mt-5" })}>
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
