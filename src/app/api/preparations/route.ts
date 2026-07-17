// 옵션 준비물 CRUD (TRD 핸드오프 §4.2)
// 저장 구조: 1행 = option_keyword + item_name (v2 스키마 그대로, 스키마 변경 금지)
//   - note 칼럼은 항목 정렬 순서(3자리 0패딩 문자열)로 사용 — 병합 시 "기존 먼저" 순서 유지
//   - 응답은 keyword 기준으로 그룹핑, 그룹 id = 첫 항목 행의 uuid (변경 후에는 재조회 전제)
// 권한: 조회 = 로그인 사용자 전체 / 등록·수정·삭제 = owner (FRD §2)

import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { normalizeText } from "@/lib/preparation-match";

const keywordSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1 && s.length <= 50, "옵션명은 1~50자여야 합니다.");

// 쉼표 분리·공백 제거·중복 제거는 클라이언트가 하지만 서버도 재검증 (FRD §4)
const itemsSchema = z
  .array(z.string().transform((s) => s.trim()))
  .transform((arr) => [...new Set(arr.filter(Boolean))])
  .refine((arr) => arr.length >= 1, "준비물을 1개 이상 입력해주세요")
  .refine((arr) => arr.length <= 30, "준비물은 최대 30개까지 등록할 수 있습니다.")
  .refine((arr) => arr.every((s) => s.length <= 30), "준비물 항목은 각 30자 이하여야 합니다.");

const postSchema = z.object({ option_keyword: keywordSchema, items: itemsSchema });

const patchSchema = z
  .object({
    id: z.string().uuid(),
    option_keyword: keywordSchema.optional(),
    items: itemsSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) => v.option_keyword !== undefined || v.items !== undefined || v.is_active !== undefined,
    "수정할 내용이 없습니다."
  );

const deleteSchema = z.object({ id: z.string().uuid() });

interface PrepRow {
  id: string;
  option_keyword: string;
  item_name: string;
  note: string | null;
  is_active: boolean;
}

interface PrepGroup {
  id: string;
  option_keyword: string;
  items: string[];
  is_active: boolean;
}

const sortKey = (r: PrepRow) => r.note ?? "999";

function groupRows(rows: PrepRow[]): PrepGroup[] {
  const byKeyword = new Map<string, PrepRow[]>();
  for (const r of rows) {
    const list = byKeyword.get(r.option_keyword) ?? [];
    list.push(r);
    byKeyword.set(r.option_keyword, list);
  }
  return [...byKeyword.entries()]
    .map(([keyword, list]) => {
      list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      return {
        id: list[0].id,
        option_keyword: keyword,
        items: list.map((r) => r.item_name),
        is_active: list.every((r) => r.is_active),
      };
    })
    .sort((a, b) => a.option_keyword.localeCompare(b.option_keyword, "ko"));
}

async function fetchRows(businessId: string): Promise<PrepRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("preparation_items")
    .select("id, option_keyword, item_name, note, is_active")
    .eq("business_id", businessId);
  if (error) throw new Error("준비물 목록을 조회하지 못했습니다.");
  return (data ?? []) as PrepRow[];
}

// 항목 행 일괄 교체: 삭제 후 순서(note)와 함께 재삽입
async function replaceKeywordRows(
  businessId: string,
  oldKeyword: string | null,
  keyword: string,
  items: string[],
  isActive: boolean
) {
  const service = createServiceClient();
  if (oldKeyword) {
    const { error } = await service
      .from("preparation_items")
      .delete()
      .eq("business_id", businessId)
      .eq("option_keyword", oldKeyword);
    if (error) throw new Error("기존 준비물 정리에 실패했습니다.");
  }
  const { error } = await service.from("preparation_items").insert(
    items.map((item, i) => ({
      business_id: businessId,
      option_keyword: keyword,
      item_name: item,
      note: String(i).padStart(3, "0"),
      is_active: isActive,
    }))
  );
  if (error) throw new Error("준비물 저장에 실패했습니다.");
}

async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

const invalid = (message: string) => NextResponse.json({ error: message }, { status: 400 });
const forbidden = () =>
  NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });

export async function GET() {
  const ctx = await requireUser(); // 직원도 조회 가능 (예약 상세 준비물 표시)
  if (!ctx) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  try {
    const rows = await fetchRows(ctx.businessId);
    return NextResponse.json({ preparations: groupRows(rows) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) return forbidden();
  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "입력이 올바르지 않습니다.");
  const { option_keyword, items } = parsed.data;

  try {
    const groups = groupRows(await fetchRows(ctx.businessId));
    // 정규화(공백 제거·소문자) 기준 중복 → 병합 모달용 409 (FRD E-A09)
    const dup = groups.find(
      (g) => normalizeText(g.option_keyword) === normalizeText(option_keyword)
    );
    if (dup) {
      return NextResponse.json(
        {
          error: "duplicate",
          existingId: dup.id,
          existingKeyword: dup.option_keyword,
          existingItems: dup.items,
        },
        { status: 409 }
      );
    }
    await replaceKeywordRows(ctx.businessId, null, option_keyword, items, true);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장에 실패했습니다." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) return forbidden();
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "입력이 올바르지 않습니다.");
  const { id, option_keyword, items, is_active } = parsed.data;

  try {
    const rows = await fetchRows(ctx.businessId);
    const groups = groupRows(rows);
    const target = groups.find((g) => rows.some((r) => r.id === id && r.option_keyword === g.option_keyword));
    if (!target) {
      return NextResponse.json({ error: "대상 옵션을 찾을 수 없습니다." }, { status: 404 });
    }

    const nextKeyword = option_keyword ?? target.option_keyword;
    if (normalizeText(nextKeyword) !== normalizeText(target.option_keyword)) {
      const dup = groups.find(
        (g) =>
          g.option_keyword !== target.option_keyword &&
          normalizeText(g.option_keyword) === normalizeText(nextKeyword)
      );
      if (dup) {
        return NextResponse.json(
          {
            error: "duplicate",
            existingId: dup.id,
            existingKeyword: dup.option_keyword,
            existingItems: dup.items,
          },
          { status: 409 }
        );
      }
    }

    if (items !== undefined || option_keyword !== undefined) {
      await replaceKeywordRows(
        ctx.businessId,
        target.option_keyword,
        nextKeyword,
        items ?? target.items,
        is_active ?? target.is_active
      );
    } else if (is_active !== undefined) {
      const service = createServiceClient();
      const { error } = await service
        .from("preparation_items")
        .update({ is_active })
        .eq("business_id", ctx.businessId)
        .eq("option_keyword", target.option_keyword);
      if (error) throw new Error("상태 변경에 실패했습니다.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정에 실패했습니다." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) return forbidden();
  const parsed = deleteSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid("삭제할 대상이 올바르지 않습니다.");

  try {
    const service = createServiceClient();
    // 대표 행 id → 키워드 전체 삭제
    const { data: row } = await service
      .from("preparation_items")
      .select("option_keyword")
      .eq("business_id", ctx.businessId)
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "대상 옵션을 찾을 수 없습니다." }, { status: 404 });
    }
    const { error } = await service
      .from("preparation_items")
      .delete()
      .eq("business_id", ctx.businessId)
      .eq("option_keyword", row.option_keyword);
    if (error) throw new Error("삭제에 실패했습니다.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
