// 마지막 업로드 되돌리기 — import_batch_items의 before_data로 복원 (TRD §3.8, 마지막 1건만)

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";

export async function POST() {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const service = createServiceClient();

  const { data: batch } = await service
    .from("import_batches")
    .select("id")
    .eq("business_id", ctx.businessId)
    .eq("source", "excel")
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!batch) {
    return NextResponse.json({ error: "되돌릴 업로드가 없습니다." }, { status: 400 });
  }

  const { data: items } = await service
    .from("import_batch_items")
    .select("*")
    .eq("batch_id", batch.id);

  try {
    for (const item of items ?? []) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const before = item.before_data as any;
      const after = item.after_data as any;
      /* eslint-enable @typescript-eslint/no-explicit-any */

      if (item.action === "create" && after?.id) {
        // 신규 생성건 → 삭제 (옵션·운영상태·이력 CASCADE)
        await service.from("reservations").delete().eq("id", after.id);
      } else if (before?.id) {
        // 갱신건 → 이전 사실정보로 복원 (운영상태는 건드리지 않음)
        await service
          .from("reservations")
          .update({
            reservation_no: before.reservation_no,
            guest_phone: before.guest_phone,
            visit_start_date: before.visit_start_date,
            visit_end_date: before.visit_end_date,
            pax: before.pax,
            channel: before.channel,
            paid_amount: before.paid_amount,
            reservation_status: before.reservation_status,
          })
          .eq("id", before.id);
        await service
          .from("reservation_options")
          .delete()
          .eq("reservation_id", before.id);
        if (Array.isArray(before.options) && before.options.length > 0) {
          await service.from("reservation_options").insert(
            before.options.map((name: string) => ({
              reservation_id: before.id,
              option_name: name,
            }))
          );
        }
      }
    }

    await service
      .from("import_batches")
      .update({ status: "reverted" })
      .eq("id", batch.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { error: `되돌리기 중 오류가 발생했습니다: ${message}` },
      { status: 500 }
    );
  }
}
