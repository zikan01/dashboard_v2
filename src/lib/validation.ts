// API 입력 검증 스키마 (Zod) — 모든 Route Handler는 클라이언트 입력을 신뢰하지 않는다
// 크기 상한은 클라이언트 제한(src/lib/excel.ts)과 맞춘다.

import { z } from "zod";

// ---- 공통 ----

export const MAX_PLAN_ITEMS = 2000; // 엑셀 행 상한(excel.ts MAX_ROWS)과 동일

const uuid = z.string().uuid();

// YYYY-MM-DD + 상식적인 범위(2000~2100)
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다.")
  .refine((s) => {
    const t = new Date(`${s}T00:00:00Z`).getTime();
    return (
      !Number.isNaN(t) &&
      s >= "2000-01-01" &&
      s <= "2100-12-31"
    );
  }, "날짜 범위가 올바르지 않습니다.");

const amount = z.number().int().min(0).max(1_000_000_000); // 금액: 0 ~ 10억
const pax = z.number().int().min(0).max(1_000); // 인원: 0 ~ 1000
const options = z.array(z.string().min(1).max(100)).max(30); // 옵션 목록

// ---- 엑셀 반영 (/api/import) ----

const parsedRowSchema = z.object({
  reservationNo: z.string().max(50).nullable(),
  guestName: z.string().min(1).max(100),
  guestPhone: z.string().min(1).max(30),
  visitStartDate: dateStr,
  visitEndDate: dateStr.nullable(),
  pax,
  options,
  paidAmount: amount,
  reservationStatus: z.enum(["confirmed", "changed", "cancelled"]),
  channel: z.string().max(100).nullable(),
});

const planItemSchema = z.object({
  action: z.enum(["create", "update", "merge", "cancel", "skip"]),
  displayNo: z.string().min(1).max(30),
  guestName: z.string().max(100),
  detail: z.string().max(500),
  row: parsedRowSchema,
  targetId: uuid.optional(),
});

export const importPlanSchema = z.object({
  plan: z.object({
    fileName: z.string().min(1).max(255),
    items: z.array(planItemSchema).min(1).max(MAX_PLAN_ITEMS),
    errors: z
      .array(z.object({ row: z.number().int(), message: z.string().max(300) }))
      .max(MAX_PLAN_ITEMS),
    counts: z.object({
      total: z.number().int().min(0).max(MAX_PLAN_ITEMS * 2),
      create: z.number().int().min(0).max(MAX_PLAN_ITEMS),
      update: z.number().int().min(0).max(MAX_PLAN_ITEMS),
      merge: z.number().int().min(0).max(MAX_PLAN_ITEMS),
      cancel: z.number().int().min(0).max(MAX_PLAN_ITEMS),
      error: z.number().int().min(0).max(MAX_PLAN_ITEMS),
    }),
  }),
});

// ---- 문의 승격 (/api/inquiries/promote) ----

export const promoteSchema = z.object({
  input: z.object({
    guestName: z.string().min(1).max(100),
    guestPhone: z.string().min(1).max(30),
    visitStartDate: dateStr,
    pax: pax.refine((n) => n >= 1, "인원은 1명 이상이어야 합니다."),
    options,
  }),
  inquiryId: uuid.optional(),
});

// ---- 예약 삭제 (/api/reservations/delete) ----

export const deleteReservationSchema = z.object({ id: uuid });

// ---- 직원 초대/상태 (/api/staff/*) ----

export const inviteStaffSchema = z.object({
  email: z.string().trim().email("이메일 형식이 올바르지 않습니다.").max(255),
  name: z.string().trim().min(1).max(100),
});

export const staffStatusSchema = z.object({
  id: uuid,
  status: z.enum(["active", "inactive"]),
});

// ---- 운영상태 수정 + 감사 로그 (/api/reservations/manual) ----

export const manualUpdateSchema = z
  .object({
    reservationId: uuid,
    patch: z.object({
      settlementStatus: z
        .enum(["needs_check", "completed", "not_applicable"])
        .optional(),
      taxInvoiceStatus: z
        .enum(["needs_check", "issued", "not_applicable"])
        .optional(),
      memo: z.string().max(2000).optional(),
    }),
    logs: z
      .array(
        z.object({
          fieldName: z.string().min(1).max(50),
          oldValue: z.string().max(2000).nullable(),
          newValue: z.string().max(2000),
        })
      )
      .max(10),
  })
  .refine(
    (v) =>
      v.patch.settlementStatus !== undefined ||
      v.patch.taxInvoiceStatus !== undefined ||
      v.patch.memo !== undefined,
    "수정할 내용이 없습니다."
  );

// ---- 공용: 요청 본문 파싱 + 검증 ----

export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { ok: false, error: "요청 본문이 올바른 JSON이 아닙니다." };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      error: `입력이 올바르지 않습니다: ${first.path.join(".")} — ${first.message}`,
    };
  }
  return { ok: true, data: result.data };
}
