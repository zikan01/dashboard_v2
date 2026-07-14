// 텍스트 문의 → 정식 예약 승격 (표시번호 부여, 병합 후보 있으면 중복 생성 금지 — TRD §3.7)

import { NextResponse } from "next/server";
import { createServiceClient, requireUser } from "@/lib/supabase/server";
import { parseBody, promoteSchema } from "@/lib/validation";

// 표시번호 생성: GMW-YYMMDD-NNN (방문일 기준 일련번호)
async function nextDisplayNo(
  service: ReturnType<typeof createServiceClient>,
  businessId: string,
  visitDate: string
): Promise<string> {
  const prefix = `GMW-${visitDate.slice(2, 4)}${visitDate.slice(5, 7)}${visitDate.slice(8, 10)}-`;
  const { data } = await service
    .from("reservations")
    .select("display_no")
    .eq("business_id", businessId)
    .like("display_no", `${prefix}%`);
  let max = 0;
  for (const r of data ?? []) {
    max = Math.max(max, parseInt(r.display_no.slice(prefix.length), 10) || 0);
  }
  return prefix + String(max + 1).padStart(3, "0");
}

export async function POST(req: Request) {
  const ctx = await requireUser("owner");
  if (!ctx) {
    return NextResponse.json({ error: "이 작업은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  const parsed = await parseBody(req, promoteSchema);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { input, inquiryId } = parsed.data;

  const service = createServiceClient();

  try {
    // 이름+연락처+방문일 일치 → 기존 예약에 병합 (신규 생성 금지)
    const { data: existing } = await service
      .from("reservations")
      .select("id, display_no")
      .eq("business_id", ctx.businessId)
      .eq("guest_name", input.guestName)
      .eq("guest_phone", input.guestPhone)
      .eq("visit_start_date", input.visitStartDate)
      .maybeSingle();

    let displayNo: string;
    let reservationId: string;

    if (existing) {
      displayNo = existing.display_no;
      reservationId = existing.id;
    } else {
      displayNo = await nextDisplayNo(service, ctx.businessId, input.visitStartDate);
      const { data: created, error: insErr } = await service
        .from("reservations")
        .insert({
          business_id: ctx.businessId,
          display_no: displayNo,
          reservation_no: null, // 텍스트 문의 → 네이버 예약번호 없음
          source: "text_inquiry",
          guest_name: input.guestName,
          guest_phone: input.guestPhone,
          visit_start_date: input.visitStartDate,
          pax: input.pax,
          channel: "전화·문자",
          paid_amount: 0,
          reservation_status: "confirmed",
        })
        .select("id")
        .single();
      if (insErr || !created) throw new Error(insErr?.message ?? "insert failed");
      reservationId = created.id;

      if (input.options.length > 0) {
        await service.from("reservation_options").insert(
          input.options.map((name) => ({
            reservation_id: reservationId,
            option_name: name,
          }))
        );
      }
      await service.from("reservation_manual_statuses").insert({
        reservation_id: reservationId,
        settlement_status: "needs_check",
        tax_invoice_status: "needs_check",
      });

      // 이력 기록
      await service.from("import_batches").insert({
        business_id: ctx.businessId,
        source: "text_inquiry",
        uploaded_by: ctx.userId,
        status: "applied",
        total_count: 1,
        new_count: 1,
        local_file_saved: null,
        applied_at: new Date().toISOString(),
      });
    }

    if (inquiryId) {
      await service
        .from("reservation_inquiries")
        .update({ status: "confirmed", promoted_reservation_id: reservationId })
        .eq("id", inquiryId)
        .eq("business_id", ctx.businessId);
    }

    return NextResponse.json({ ok: true, displayNo });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { error: `예약 승격에 실패했습니다: ${message}` },
      { status: 500 }
    );
  }
}
