-- ============================================================
-- 0004: 연락처 유실 방지 가드
-- 적용: Dashboard → SQL Editor 에 전체 붙여넣기 → Run
--
-- 배경
--   네이버는 방문일이 지나면 예약자 전화번호를 마스킹(예: ******4158)한다.
--   기존 apply_import_plan(0003)은 guest_phone을 조건 없이 덮어쓰므로,
--   방문 전에 확보한 정상 번호가 방문일 이후 재업로드 시 마스킹 값으로
--   대체되어 영구 유실된다.
--
-- 변경
--   새 값에 '*'가 포함(마스킹)되어 있고 기존 값이 정상 번호이면
--   기존 번호를 유지한다. 그 외에는 기존 동작과 동일하다.
--   배치 이력(after_data)에도 실제 저장된 번호를 기록한다.
-- ============================================================

CREATE OR REPLACE FUNCTION apply_import_plan(
  p_business_id uuid,
  p_user_id uuid,
  p_file_name text,
  p_items jsonb,
  p_counts jsonb
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid;
  v_item jsonb;
  v_row jsonb;
  v_action text;
  v_target uuid;
  v_before jsonb;
  v_res_id uuid;
  v_cancelled boolean;
  v_new_phone text;
BEGIN
  -- 배치 먼저 생성 (실패 시 함수 전체가 롤백되므로 잔재 없음)
  INSERT INTO import_batches (
    business_id, source, file_name, uploaded_by, status,
    total_count, new_count, update_count, cancel_count, error_count,
    local_file_saved, applied_at
  ) VALUES (
    p_business_id, 'excel', p_file_name, p_user_id, 'applied',
    coalesce((p_counts->>'total')::int, 0),
    coalesce((p_counts->>'create')::int, 0),
    coalesce((p_counts->>'update')::int, 0) + coalesce((p_counts->>'merge')::int, 0),
    coalesce((p_counts->>'cancel')::int, 0),
    coalesce((p_counts->>'error')::int, 0),
    null, now()
  ) RETURNING id INTO v_batch_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_action := v_item->>'action';
    v_row := v_item->'row';

    IF v_action = 'skip' THEN
      INSERT INTO import_batch_items (batch_id, reservation_no, display_no, action, before_data, after_data, error_message)
      VALUES (v_batch_id, nullif(v_row->>'reservationNo',''), v_item->>'displayNo', 'skip', null, null, null);
      CONTINUE;
    END IF;

    v_target := nullif(v_item->>'targetId','')::uuid;

    IF v_target IS NOT NULL THEN
      -- 업데이트/병합/취소 — 사실정보만 갱신 (§3.6: 운영상태는 건드리지 않음)
      SELECT jsonb_build_object(
        'id', r.id,
        'reservation_no', r.reservation_no,
        'guest_phone', r.guest_phone,
        'visit_start_date', r.visit_start_date,
        'visit_end_date', r.visit_end_date,
        'pax', r.pax,
        'channel', r.channel,
        'paid_amount', r.paid_amount,
        'reservation_status', r.reservation_status,
        'options', coalesce(
          (SELECT jsonb_agg(o.option_name) FROM reservation_options o WHERE o.reservation_id = r.id),
          '[]'::jsonb
        )
      ) INTO v_before
      FROM reservations r
      WHERE r.id = v_target AND r.business_id = p_business_id;

      IF v_before IS NULL THEN
        CONTINUE; -- 대상 없음(오래된 계획) — 건너뜀
      END IF;

      -- 연락처 유실 방지: 마스킹 값이 정상 번호를 덮어쓰지 않는다
      v_new_phone := CASE
        WHEN (v_row->>'guestPhone') LIKE '%*%'
         AND (v_before->>'guest_phone') NOT LIKE '%*%'
        THEN v_before->>'guest_phone'
        ELSE v_row->>'guestPhone'
      END;

      UPDATE reservations SET
        guest_phone = v_new_phone,
        visit_start_date = (v_row->>'visitStartDate')::date,
        visit_end_date = nullif(v_row->>'visitEndDate','')::date,
        pax = coalesce((v_row->>'pax')::int, 0),
        paid_amount = coalesce((v_row->>'paidAmount')::int, 0),
        reservation_status = v_row->>'reservationStatus',
        reservation_no = coalesce(nullif(v_row->>'reservationNo',''), reservation_no),
        channel = coalesce(nullif(v_row->>'channel',''), channel),
        updated_at = now()
      WHERE id = v_target AND business_id = p_business_id;

      IF jsonb_array_length(coalesce(v_row->'options','[]'::jsonb)) > 0 THEN
        DELETE FROM reservation_options WHERE reservation_id = v_target;
        INSERT INTO reservation_options (reservation_id, option_name)
        SELECT v_target, value #>> '{}' FROM jsonb_array_elements(v_row->'options');
      END IF;

      INSERT INTO import_batch_items (batch_id, reservation_no, display_no, action, before_data, after_data, error_message)
      VALUES (
        v_batch_id,
        nullif(v_row->>'reservationNo',''),
        v_item->>'displayNo',
        CASE WHEN v_action = 'merge' THEN 'merge' ELSE 'update' END,
        v_before,
        jsonb_build_object(
          'id', v_target,
          'guest_phone', v_new_phone,
          'visit_start_date', v_row->>'visitStartDate',
          'visit_end_date', v_row->>'visitEndDate',
          'pax', coalesce((v_row->>'pax')::int, 0),
          'paid_amount', coalesce((v_row->>'paidAmount')::int, 0),
          'reservation_status', v_row->>'reservationStatus',
          'options', coalesce(v_row->'options','[]'::jsonb)
        ),
        null
      );
    ELSE
      -- 신규 생성 — 표시번호 유니크 충돌 시 예외 → 전체 롤백
      v_cancelled := (v_row->>'reservationStatus') = 'cancelled';

      INSERT INTO reservations (
        business_id, display_no, reservation_no, source, guest_name, guest_phone,
        visit_start_date, visit_end_date, pax, channel, paid_amount, reservation_status, imported_at
      ) VALUES (
        p_business_id,
        v_item->>'displayNo',
        nullif(v_row->>'reservationNo',''),
        'excel',
        v_row->>'guestName',
        v_row->>'guestPhone',
        (v_row->>'visitStartDate')::date,
        nullif(v_row->>'visitEndDate','')::date,
        coalesce((v_row->>'pax')::int, 0),
        nullif(v_row->>'channel',''),
        coalesce((v_row->>'paidAmount')::int, 0),
        v_row->>'reservationStatus',
        now()
      ) RETURNING id INTO v_res_id;

      IF jsonb_array_length(coalesce(v_row->'options','[]'::jsonb)) > 0 THEN
        INSERT INTO reservation_options (reservation_id, option_name)
        SELECT v_res_id, value #>> '{}' FROM jsonb_array_elements(v_row->'options');
      END IF;

      -- 기본값 규칙 (FRD §5): 취소는 해당 없음, 그 외 별도 확인 필요
      INSERT INTO reservation_manual_statuses (reservation_id, settlement_status, tax_invoice_status)
      VALUES (
        v_res_id,
        CASE WHEN v_cancelled THEN 'not_applicable' ELSE 'needs_check' END,
        CASE WHEN v_cancelled THEN 'not_applicable' ELSE 'needs_check' END
      );

      INSERT INTO import_batch_items (batch_id, reservation_no, display_no, action, before_data, after_data, error_message)
      VALUES (
        v_batch_id,
        nullif(v_row->>'reservationNo',''),
        v_item->>'displayNo',
        'create',
        null,
        jsonb_build_object('id', v_res_id, 'options', coalesce(v_row->'options','[]'::jsonb)),
        null
      );
    END IF;
  END LOOP;

  RETURN v_batch_id;
END;
$$;

-- 서버(Service Role) 전용 — 클라이언트 직접 호출 차단 (0003과 동일, 재선언은 무해)
REVOKE EXECUTE ON FUNCTION apply_import_plan(uuid, uuid, text, jsonb, jsonb) FROM public, anon, authenticated;
