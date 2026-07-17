"use client";

// 예약 상세 준비물 카드 (S-A03, E-A15~18) — 상세 페이지에는 이 컴포넌트 1줄만 삽입
// 매칭은 조회 시 계산(lib/preparation-match) — 준비물 수정이 과거 예약에도 즉시 반영
// 실패 시 옵션 원문만 표시 (PRD A-003 Error 규칙) — 기존 상세 레이아웃을 깨지 않는다.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  matchReservationOptions,
  type PreparationGroup,
} from "@/lib/preparation-match";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardCaption, CardTitle } from "@/components/ui/card";

type FetchState = "loading" | "success" | "error";

export function PreparationCard({
  options,
  className,
}: {
  options: string[];
  className?: string;
}) {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [state, setState] = useState<FetchState>("loading");
  const [groups, setGroups] = useState<PreparationGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/preparations")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState("error");
          return;
        }
        setGroups(data.preparations ?? []);
        setState("success");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = matchReservationOptions(options, groups);

  return (
    <Card className={className}>
      <CardTitle>준비물</CardTitle>
      <CardCaption>
        옵션 업로드에서 등록한 준비물이 옵션명 부분 일치로 자동 표시됩니다.
      </CardCaption>

      {options.length === 0 && (
        <div className="py-2 text-[12.5px] text-muted">옵션이 없습니다.</div>
      )}

      {state === "loading" && options.length > 0 && (
        <div className="space-y-2 py-1">
          {options.slice(0, 3).map((o) => (
            <div key={o} className="h-[30px] animate-pulse rounded-[9px] bg-sand-100" />
          ))}
        </div>
      )}

      {state !== "loading" &&
        matches.map((m) => (
          <div
            key={m.optionName}
            className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-[#f0ece2] px-1 py-3 last:border-b-0"
          >
            <div className="min-w-[70px] text-[13px] font-semibold text-green-700">
              {m.optionName}
            </div>
            {state === "error" ? (
              // 목록 조회 실패 — 옵션 원문만 표시 (레이아웃 유지)
              <span className="text-[12px] text-muted">
                준비물을 불러오지 못했습니다
              </span>
            ) : m.matched ? (
              <div className="flex flex-wrap gap-1.5">
                {m.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-full bg-sand-100 px-2.5 py-[3px] text-[11.5px] text-[#55514a]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <>
                <Badge variant="gray">준비물 미등록</Badge>
                {isOwner && (
                  <Link
                    href={`/options?keyword=${encodeURIComponent(m.optionName)}`}
                    className="text-[12px] font-semibold text-green-700 hover:underline"
                  >
                    등록하기 →
                  </Link>
                )}
              </>
            )}
          </div>
        ))}
    </Card>
  );
}
