"use client";

import { cn } from "@/lib/utils";

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean;
}

// 프로토타입의 .chip 필터 버튼
export function Chip({ on, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-btn border px-3 py-[7px] text-[12.5px] transition-colors",
        on
          ? "border-green-700 bg-green-700 text-white"
          : "border-border bg-white text-[#55514a] hover:bg-[#f5f2ea]",
        className
      )}
      {...props}
    />
  );
}
