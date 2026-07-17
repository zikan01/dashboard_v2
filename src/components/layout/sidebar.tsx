"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  CalendarDays,
  Upload,
  PackageOpen,
  MessageSquareText,
  FileDown,
  History,
  Users,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";

const MAIN_NAV = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/reservations", label: "예약 목록", icon: ClipboardList },
  { href: "/calendar", label: "예약 캘린더", icon: CalendarDays },
];

// 관리자 전용 메뉴 — 직원(staff) 로그인 시 숨김 (업로드 이력은 직원도 열람 가능, FRD §1)
const ADMIN_NAV = [
  { href: "/upload", label: "엑셀 업로드", icon: Upload },
  { href: "/options", label: "옵션 업로드", icon: PackageOpen, isNew: true },
  { href: "/inquiries", label: "텍스트 문의", icon: MessageSquareText, isNew: true },
  { href: "/export", label: "데이터 내보내기", icon: FileDown, isNew: true },
  { href: "/history", label: "업로드 이력", icon: History },
  { href: "/staff", label: "직원 관리", icon: Users },
];

const STAFF_EXTRA_NAV = [{ href: "/history", label: "업로드 이력", icon: History }];

function NavLink({
  href,
  label,
  icon: Icon,
  isNew,
  active,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isNew?: boolean;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-[11px] rounded-btn px-3 py-[9px] text-[13.5px] transition-colors",
        active
          ? "bg-green-100 font-semibold text-green-900"
          : "text-[#55514a] hover:bg-[#f5f2ea]"
      )}
    >
      <Icon size={16} className="opacity-80" />
      {label}
      {isNew && (
        <span className="ml-auto rounded-full bg-green-100 px-1.5 py-px text-[10px] font-semibold text-green-700">
          NEW
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const isOwner = user?.role === "owner";

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <aside className="sticky top-0 flex h-screen w-[230px] shrink-0 flex-col border-r border-border bg-white">
      <div className="flex items-center gap-2.5 px-[18px] py-5">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-green-900 text-[15px] font-bold text-white">
          고
        </div>
        <div>
          <b className="text-[15px]">고마워할매</b>
          <span className="block text-[11px] text-muted">예약 운영</span>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-1">
        {MAIN_NAV.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(item.href)} />
        ))}
        {isOwner ? (
          <>
            <div className="px-3.5 pb-1 pt-3 text-[10.5px] tracking-wide text-faint">
              관리자
            </div>
            {ADMIN_NAV.map((item) => (
              <NavLink key={item.href} {...item} active={isActive(item.href)} />
            ))}
          </>
        ) : (
          STAFF_EXTRA_NAV.map((item) => (
            <NavLink key={item.href} {...item} active={isActive(item.href)} />
          ))
        )}
      </nav>
      <div className="flex items-center gap-2.5 border-t border-border px-4 py-3.5">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-900">
          {user?.name.slice(0, 1) ?? "?"}
        </div>
        <div className="min-w-0 flex-1">
          <b className="text-[13px]">{user?.name}</b>
          <div className="text-[11px] text-muted">{user?.roleLabel}</div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          title="로그아웃"
          className="flex h-8 w-8 items-center justify-center rounded-btn text-muted transition-colors hover:bg-[#f5f2ea] hover:text-ink"
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
}
