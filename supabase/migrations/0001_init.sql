-- 고마워할매 예약 운영 대시보드 — 초기 스키마
-- 출처: TRD 핸드오프 §3.2(테이블) §3.3(RLS) §3.4(인덱스)
-- 실행: Supabase Dashboard → SQL Editor 에 전체 붙여넣기 → Run

-- ============================================================
-- 1. 테이블 (TRD §3.2)
-- ============================================================

-- 사업장 (v1 1곳 전용, 확장 훅)
CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 사용자 프로필 (Supabase auth.users와 1:1)
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','staff')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 예약 (자체 PK + 네이버 예약번호 선택)
CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  display_no text NOT NULL,                         -- 표시번호 GMW-260709-001
  reservation_no text,                              -- 네이버 예약번호(있으면), 없으면 NULL
  source text NOT NULL CHECK (source IN ('excel','local_collector','text_inquiry')),
  guest_name text NOT NULL,
  guest_phone text NOT NULL,
  visit_start_date date NOT NULL,
  visit_end_date date,
  pax integer NOT NULL DEFAULT 0,
  channel text,
  paid_amount integer NOT NULL DEFAULT 0,
  reservation_status text NOT NULL CHECK (reservation_status IN ('confirmed','changed','cancelled')),
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, display_no)
);

-- 예약 옵션
CREATE TABLE reservation_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  option_name text NOT NULL,
  quantity integer,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 운영 상태 (Supabase가 원본 — 업로드로 덮어쓰기 금지 대상)
CREATE TABLE reservation_manual_statuses (
  reservation_id uuid PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
  settlement_status text NOT NULL DEFAULT 'needs_check'
    CHECK (settlement_status IN ('needs_check','completed','not_applicable')),
  tax_invoice_status text NOT NULL DEFAULT 'needs_check'
    CHECK (tax_invoice_status IN ('needs_check','issued','not_applicable')),
  memo text,
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 텍스트 예약 문의 (검수 후 예약 승격)
CREATE TABLE reservation_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  raw_text text NOT NULL,                           -- 원문 보존
  parsed jsonb,                                     -- {guest_name,phone,date,pax,options...}
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','rejected')),
  promoted_reservation_id uuid REFERENCES reservations(id),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 준비물 예시
CREATE TABLE preparation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  option_keyword text NOT NULL,
  item_name text NOT NULL,
  note text,
  is_active boolean NOT NULL DEFAULT true
);

-- 업로드/수집 배치
CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  source text NOT NULL CHECK (source IN ('excel','local_collector','text_inquiry')),
  file_name text,
  uploaded_by uuid REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview','applied','failed','reverted')),
  total_count integer DEFAULT 0,
  new_count integer DEFAULT 0,
  update_count integer DEFAULT 0,
  cancel_count integer DEFAULT 0,
  error_count integer DEFAULT 0,
  local_file_saved boolean DEFAULT false,           -- 로컬 엑셀 저장 성공 여부(동기화 검증)
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

-- 배치 항목 (되돌리기용 before/after)
CREATE TABLE import_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  reservation_no text,
  display_no text,
  action text NOT NULL CHECK (action IN ('create','update','skip','error','merge')),
  before_data jsonb,
  after_data jsonb,
  error_message text
);

-- 수정 이력
CREATE TABLE reservation_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- 내보내기 프로필 (원하는 필드만 엑셀로)
CREATE TABLE export_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  columns jsonb NOT NULL,                           -- ["display_no","visit_start_date",...]
  filters jsonb,                                    -- {status, period ...}
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. RLS (TRD §3.3)
-- ============================================================

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_manual_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE preparation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- 헬퍼: 현재 사용자의 business_id
-- SECURITY DEFINER: 함수 내부의 profiles 조회가 RLS를 우회해 무한 재귀를 방지
CREATE OR REPLACE FUNCTION current_business_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT business_id FROM profiles WHERE id = auth.uid() AND status = 'active'
$$;

-- 헬퍼: 현재 사용자가 owner인가
CREATE OR REPLACE FUNCTION is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role='owner' AND status='active')
$$;

-- 사업장: 같은 사업장만 조회
CREATE POLICY businesses_select ON businesses
  FOR SELECT USING (id = current_business_id());

-- 예약: 같은 사업장이면 조회(직원 포함), 쓰기는 서버(Service Role)만
CREATE POLICY reservations_select ON reservations
  FOR SELECT USING (business_id = current_business_id());
-- INSERT/UPDATE/DELETE 정책 없음 → anon/authenticated 불가, 서버(service_role)만 우회

-- 예약 옵션: 같은 사업장 예약의 옵션만 조회
CREATE POLICY reservation_options_select ON reservation_options
  FOR SELECT USING (
    reservation_id IN (SELECT id FROM reservations WHERE business_id = current_business_id())
  );

-- 운영상태: 조회는 같은 사업장, 수정은 활성 사용자(owner+staff 모두 허용)
CREATE POLICY manual_status_select ON reservation_manual_statuses
  FOR SELECT USING (
    reservation_id IN (SELECT id FROM reservations WHERE business_id = current_business_id())
  );
CREATE POLICY manual_status_update ON reservation_manual_statuses
  FOR UPDATE USING (
    reservation_id IN (SELECT id FROM reservations WHERE business_id = current_business_id())
  );

-- 텍스트 문의: owner만 쓰기, 같은 사업장 조회
CREATE POLICY inquiries_select ON reservation_inquiries
  FOR SELECT USING (business_id = current_business_id());
CREATE POLICY inquiries_write ON reservation_inquiries
  FOR ALL USING (business_id = current_business_id() AND is_owner());

-- 배치/배치항목: 같은 사업장 조회 (쓰기는 서버만)
CREATE POLICY batches_select ON import_batches
  FOR SELECT USING (business_id = current_business_id());
CREATE POLICY batch_items_select ON import_batch_items
  FOR SELECT USING (
    batch_id IN (SELECT id FROM import_batches WHERE business_id = current_business_id())
  );

-- 감사로그: 같은 사업장 조회, 삽입은 활성 사용자
CREATE POLICY audit_select ON reservation_audit_logs
  FOR SELECT USING (
    reservation_id IN (SELECT id FROM reservations WHERE business_id = current_business_id())
  );
CREATE POLICY audit_insert ON reservation_audit_logs
  FOR INSERT WITH CHECK (
    reservation_id IN (SELECT id FROM reservations WHERE business_id = current_business_id())
  );

-- 준비물: 같은 사업장 조회, owner만 쓰기
CREATE POLICY prep_select ON preparation_items
  FOR SELECT USING (business_id = current_business_id());
CREATE POLICY prep_write ON preparation_items
  FOR ALL USING (business_id = current_business_id() AND is_owner());

-- 내보내기 프로필: 같은 사업장 조회, owner만 쓰기
CREATE POLICY export_select ON export_profiles
  FOR SELECT USING (business_id = current_business_id());
CREATE POLICY export_write ON export_profiles
  FOR ALL USING (business_id = current_business_id() AND is_owner());

-- 프로필: 본인 조회 + owner는 사업장 전체 조회/관리
CREATE POLICY profiles_self ON profiles
  FOR SELECT USING (id = auth.uid() OR (business_id = current_business_id() AND is_owner()));

-- ============================================================
-- 3. 인덱스 (TRD §3.4)
-- ============================================================

CREATE INDEX idx_res_business_visit ON reservations(business_id, visit_start_date);
CREATE INDEX idx_res_status ON reservations(business_id, reservation_status);
CREATE INDEX idx_res_display_no ON reservations(business_id, display_no);
-- 네이버 예약번호는 있을 때만 사업장 내 유일
CREATE UNIQUE INDEX uq_res_reservation_no
  ON reservations(business_id, reservation_no)
  WHERE reservation_no IS NOT NULL;
-- 중복 병합 후보 탐색용 (이름+연락처+방문일)
CREATE INDEX idx_res_merge_key ON reservations(business_id, guest_name, guest_phone, visit_start_date);
CREATE INDEX idx_inq_status ON reservation_inquiries(business_id, status);
CREATE INDEX idx_batch_items_batch ON import_batch_items(batch_id);

-- ============================================================
-- 4. 시드: 사업장 1곳 (v1 단일 사업장)
-- ============================================================

INSERT INTO businesses (name) VALUES ('고마워할매');

-- 준비물 예시 (FRD §8)
INSERT INTO preparation_items (business_id, option_keyword, item_name)
SELECT b.id, kw, item FROM businesses b,
  (VALUES
    ('바베큐', '고기, 숯, 집게, 장갑, 채소, 일회용 식기'),
    ('계곡', '물놀이 안내, 안전용품, 수건, 구급용품'),
    ('버스왕복', '차량 배차 확인, 탑승 인원 확인, 기사 연락'),
    ('매실', '매실, 설탕, 용기, 장갑'),
    ('숙박', '침구, 객실 정리, 수건, 비품')
  ) AS t(kw, item)
WHERE b.name = '고마워할매';
