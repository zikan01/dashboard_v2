-- RLS 무한 재귀 수정
-- 문제: current_business_id()가 profiles를 조회 → profiles RLS가 다시 current_business_id() 호출 → 재귀
-- 해결: 헬퍼 함수를 SECURITY DEFINER로 — 함수 내부 조회는 RLS를 우회 (Supabase 표준 패턴)

CREATE OR REPLACE FUNCTION current_business_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT business_id FROM profiles WHERE id = auth.uid() AND status = 'active'
$$;

CREATE OR REPLACE FUNCTION is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role='owner' AND status='active')
$$;
