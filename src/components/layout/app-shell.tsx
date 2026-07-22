"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ReservationSheetProvider } from "@/components/reservation-sheet";

/**
 * 반응형 앱 셸.
 * - 데스크톱(lg 이상): 사이드바가 좌측에 고정(sticky)되는 기존 레이아웃 유지.
 * - 모바일(lg 미만): 사이드바를 오프캔버스 드로어로 전환하고, 상단 햄버거 버튼으로 열고 닫는다.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // 페이지 이동 시 드로어 자동 닫힘
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // 드로어가 열려 있는 동안 본문 스크롤 잠금 (모바일)
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  return (
    <div className="flex min-h-screen">
      {/* 모바일 드로어 오버레이 */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden
        />
      )}

      <Sidebar mobileOpen={open} onClose={() => setOpen(false)} />

      <main className="min-w-0 flex-1">
        {/* 모바일 전용 상단 바 (햄버거) */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="메뉴 열기"
            className="flex h-9 w-9 items-center justify-center rounded-btn border border-border text-ink hover:bg-[#f5f2ea]"
          >
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-green-900 text-[12px] font-bold text-white">
              고
            </div>
            <b className="text-[14px]">고마워할매</b>
          </div>
        </div>

        <Topbar />
        <div className="px-4 pb-10 pt-1 sm:px-6 lg:px-8">
          <ReservationSheetProvider>{children}</ReservationSheetProvider>
        </div>
      </main>
    </div>
  );
}
