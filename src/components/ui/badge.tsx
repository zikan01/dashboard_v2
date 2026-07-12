import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type {
  BatchStatus,
  InquiryStatus,
  PreviewAction,
  ReservationStatus,
  SettlementStatus,
  TaxInvoiceStatus,
} from "@/lib/types";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold",
  {
    variants: {
      variant: {
        green: "bg-green-100 text-green-700",
        amber: "bg-amber-100 text-amber-700",
        gray: "bg-sand-100 text-[#8b8578]",
      },
    },
    defaultVariants: { variant: "green" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// ---- 도메인 상태 → 배지 변형 매핑 ----

export const reservationStatusVariant: Record<
  ReservationStatus,
  BadgeProps["variant"]
> = {
  confirmed: "green",
  changed: "amber",
  cancelled: "gray",
};

export const settlementVariant: Record<SettlementStatus, BadgeProps["variant"]> = {
  needs_check: "amber",
  completed: "green",
  not_applicable: "gray",
};

export const taxVariant: Record<TaxInvoiceStatus, BadgeProps["variant"]> = {
  needs_check: "amber",
  issued: "green",
  not_applicable: "gray",
};

export const inquiryStatusVariant: Record<InquiryStatus, BadgeProps["variant"]> = {
  pending: "amber",
  confirmed: "green",
  rejected: "gray",
};

export const batchStatusVariant: Record<BatchStatus, BadgeProps["variant"]> = {
  applied: "green",
  reverted: "amber",
  failed: "gray",
};

export const previewActionVariant: Record<PreviewAction, BadgeProps["variant"]> = {
  create: "green",
  update: "green",
  merge: "amber",
  change: "amber",
  cancel: "gray",
  skip: "gray",
  error: "gray",
};
