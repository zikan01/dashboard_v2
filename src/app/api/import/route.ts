// 엑셀 업로드 반영 — 예약 사실정보 쓰기는 서버(Service Role)만 (TRD §3.3)
// ⚠️ 필드 소유권(§3.6): reservation_manual_statuses는 절대 UPDATE하지 않는다.
//    신규 예약일 때만 기본값 생성.

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import type { ImportPlan, PlanItem } from "@/lib/excel";

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const { plan } = (await req.json()) as { plan: ImportPlan };
  if (!plan?.items) {
    return NextResponse.json({ error: "반영할 내용이 없습니다." }, { status: 400 });
  }

  const service = createServiceClient();
  const batchItems: {
    reservation_no: string | null;
    display_no: string;
    action: string;
    before_data: unknown;
    after_data: unknown;
    error_message: string | null;
  }[] = [];

  try {
    for (const item of plan.items as PlanItem[]) {
      if (item.action === "skip") {
        batchItems.push({
          reservation_no: item.row.reservationNo,
          display_no: item.displayNo,
          action: "skip",
          before_data: null,
          after_data: null,
          error_message: null,
        });
        continue;
      }
      const p = item.row;

      if (item.targetId) {
        // 업데이트/병합/취소 — 사실정보만 갱신
        const { data: before } = await service
          .from("reservations")
          .select("*, reservation_options(option_name)")
          .eq("id", item.targetId)
          .eq("business_id", ctx.businessId)
          .single();
        if (!before) continue;

        const patch: Record<string, unknown> = {
          guest_phone: p.guestPhone,
          visit_start_date: p.visitStartDate,
          visit_end_date: p.visitEndDate,
          pax: p.pax,
          paid_amount: p.paidAmount,
          reservation_status: p.reservationStatus,
          updated_at: new Date().toISOString(),
        };
        if (p.reservationNo) patch.reservation_no = p.reservationNo;
        if (p.channel) patch.channel = p.channel;

        const { error: upErr } = await service
          .from("reservations")
          .update(patch)
          .eq("id", item.targetId);
        if (upErr) throw new Error(upErr.message);

        if (p.options.length > 0) {
          await service
            .from("reservation_options")
            .delete()
            .eq("reservation_id", item.targetId);
          await service.from("reservation_options").insert(
            p.options.map((name) => ({
              reservation_id: item.targetId,
              option_name: name,
            }))
          );
        }

        batchItems.push({
          reservation_no: p.reservationNo,
          display_no: item.displayNo,
          action: item.action === "merge" ? "merge" : "update",
          before_data: {
            id: before.id,
            reservation_no: before.reservation_no,
            guest_phone: before.guest_phone,
            visit_start_date: before.visit_start_date,
            visit_end_date: before.visit_end_date,
            pax: before.pax,
            channel: before.channel,
            paid_amount: before.paid_amount,
            reservation_status: before.reservation_status,
            options: (before.reservation_options ?? []).map(
              (o: { option_name: string }) => o.option_name
            ),
          },
          after_data: { id: before.id, ...patch, options: p.options },
          error_message: null,
        });
      } else {
        // 신규 생성 — 표시번호는 클라이언트 계획값 사용, 유니크 충돌 시 오류
        const cancelled = p.reservationStatus === "cancelled";
        const { data: created, error: insErr } = await service
          .from("reservations")
          .insert({
            business_id: ctx.businessId,
            display_no: item.displayNo,
            reservation_no: p.reservationNo,
            source: "excel",
            guest_name: p.guestName,
            guest_phone: p.guestPhone,
            visit_start_date: p.visitStartDate,
            visit_end_date: p.visitEndDate,
            pax: p.pax,
            channel: p.channel,
            paid_amount: p.paidAmount,
            reservation_status: p.reservationStatus,
            imported_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (insErr || !created) throw new Error(insErr?.message ?? "insert failed");

        if (p.options.length > 0) {
          await service.from("reservation_options").insert(
            p.options.map((name) => ({
              reservation_id: created.id,
              option_name: name,
            }))
          );
        }
        // 기본값 규칙 (FRD §5): 취소는 해당 없음, 그 외 별도 확인 필요
        await service.from("reservation_manual_statuses").insert({
          reservation_id: created.id,
          settlement_status: cancelled ? "not_applicable" : "needs_check",
          tax_invoice_status: cancelled ? "not_applicable" : "needs_check",
        });

        batchItems.push({
          reservation_no: p.reservationNo,
          display_no: item.displayNo,
          action: "create",
          before_data: null,
          after_data: { id: created.id, options: p.options },
          error_message: null,
        });
      }
    }

    // 배치 + 항목 기록 (업로드 이력·되돌리기용)
    const { data: batch, error: batchErr } = await service
      .from("import_batches")
      .insert({
        business_id: ctx.businessId,
        source: "excel",
        file_name: plan.fileName,
        uploaded_by: ctx.userId,
        status: "applied",
        total_count: plan.counts.total,
        new_count: plan.counts.create,
        update_count: plan.counts.update + plan.counts.merge,
        cancel_count: plan.counts.cancel,
        error_count: plan.counts.error,
        local_file_saved: null, // 로컬 엑셀 동시 저장은 후속 작업
        applied_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (batchErr || !batch) throw new Error(batchErr?.message ?? "batch insert failed");

    await service.from("import_batch_items").insert(
      batchItems.map((it) => ({ ...it, batch_id: batch.id }))
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "반영 중 오류가 발생했습니다.";
    await service.from("import_batches").insert({
      business_id: ctx.businessId,
      source: "excel",
      file_name: plan.fileName,
      uploaded_by: ctx.userId,
      status: "failed",
      total_count: plan.counts.total,
      error_count: plan.counts.error,
    });
    return NextResponse.json(
      { error: `예약 데이터를 저장하지 못했습니다: ${message}` },
      { status: 500 }
    );
  }
}
