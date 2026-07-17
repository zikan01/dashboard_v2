-- 추가기능 (2026-07-17 증분): 옵션·준비물 수기 입력 + 암호화 엑셀 자동 복호화
-- 출처: trd-gomawohalme-addon-20260717-handoff.md §2
-- 실행: Supabase Dashboard → SQL Editor 에 전체 붙여넣기 → Run

-- ============================================================
-- 1. 관리자 설정 (비밀번호 암호문, 수집기 토큰 해시)
-- ============================================================

CREATE TABLE app_settings (
  key text PRIMARY KEY,               -- 'excel_file_password' | 'collector_token_hash'
  -- 형식이 key마다 다름 (QA #4):
  --   excel_file_password  = AES-256-GCM 암호문 "iv:tag:cipher" (각 base64, 복호화 가능)
  --   collector_token_hash = sha256 hex (해시, 복원 불가)
  value text NOT NULL,
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 접근은 서버 라우트(Service Role)로만 수행하고 RLS는 이중 방어.
-- 클라이언트에서 직접 조회 금지 — owner라도 값(암호문·해시)을 화면에 내리지 않는다.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_settings_owner_only ON app_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  );

-- ============================================================
-- 2. 준비물: 1행 = 키워드+항목 단위 정리 + 중복 등록 방지
-- ============================================================

-- 0001 시드는 준비물 여러 개를 한 행의 item_name에 쉼표로 담고 있음
-- ("고기, 숯, 집게, 장갑, ...") → 1행 = keyword+item 단위(v2 스키마 의도)로 분리
-- note 칼럼은 항목 정렬 순서(3자리 0패딩)로 사용한다 — /api/preparations 참조
INSERT INTO preparation_items (business_id, option_keyword, item_name, note, is_active)
SELECT p.business_id,
       p.option_keyword,
       trim(x.item),
       lpad((x.ord - 1)::text, 3, '0'),
       p.is_active
FROM preparation_items p,
     LATERAL unnest(string_to_array(p.item_name, ',')) WITH ORDINALITY AS x(item, ord)
WHERE p.item_name LIKE '%,%' AND trim(x.item) <> '';

DELETE FROM preparation_items WHERE item_name LIKE '%,%';

-- 남은 중복 제거 후 유니크 인덱스 (동일 키워드+항목 재등록 방지)
DELETE FROM preparation_items a
USING preparation_items b
WHERE a.id > b.id
  AND a.business_id = b.business_id
  AND a.option_keyword = b.option_keyword
  AND a.item_name = b.item_name;

CREATE UNIQUE INDEX uq_preparation_items_keyword_item
  ON preparation_items (business_id, option_keyword, item_name);
