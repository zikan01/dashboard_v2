"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Upload } from "lucide-react";
import { formatKoreanDate, todayStr } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";

const TITLES: [string, string][] = [
  ["/reservations/", "예약 상세"],
  ["/reservations", "예약 목록"],
  ["/calendar", "예약 캘린더"],
  ["/upload", "엑셀 업로드"],
  ["/options", "옵션 업로드"],
  ["/inquiries", "텍스트 문의"],
  ["/export", "데이터 내보내기"],
  ["/history", "업로드·수집 이력"],
  ["/staff", "직원 관리"],
  ["/notifications/schedule", "발송 일정"],
  ["/notifications/history", "발송 이력"],
  ["/notifications/failures", "실패 관리"],
  ["/settings/notifications", "자동 안내 설정"],
  ["/settings/templates", "메시지 템플릿"],
  ["/settings/providers/solapi", "SOLAPI 설정"],
];

export function Topbar() {
  const pathname = usePathname();
  const { user } = useAuth();
  // 날짜는 클라이언트에서만 렌더 (SSR 프리렌더 시점과 달라도 hydration 불일치가 없도록)
  const [today, setToday] = useState("");
  useEffect(() => setToday(todayStr()), []);
  const title =
    TITLES.find(([prefix]) =>
      prefix.endsWith("/") ? pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1) : pathname.startsWith(prefix)
    )?.[1] ?? "대시보드";

  // 홈은 자체 헤더 배너(경영 정보 대시보드)가 제목·날짜를 대신한다
  if (pathname === "/") return <div className="pt-4" />;

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pb-2.5 pt-5 sm:px-6 sm:pt-6 lg:px-8">
      <div>
        <h1 className="text-[19px] font-bold sm:text-[22px]">{title}</h1>
        <div className="mt-[3px] min-h-[18px] text-[12.5px] text-muted">
          {today ? formatKoreanDate(today) : ""}
        </div>
      </div>
      {/* 가져오기 버튼은 관리자(owner) 전용 */}
      {user?.role === "owner" && (
        <Link href="/upload" className={buttonVariants()}>
          <Upload size={15} />
          예약 데이터 가져오기
        </Link>
      )}
    </div>
  );
}
