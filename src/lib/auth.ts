// 프로토타입용 임시 로그인 — 검증 로직을 이 파일에 모아둔다.
// TODO: 2단계에서 Supabase Auth로 교체 (이메일/비밀번호 + owner/staff 역할 + RLS)
// ⚠️ 프론트엔드에 하드코딩된 자격증명은 목업 시연용일 뿐 실제 보안이 아니다.

import type { StaffRole } from "./types";

export interface SessionUser {
  name: string;
  role: StaffRole;
  roleLabel: string;
}

const MOCK_CREDENTIALS = { id: "admin", password: "admin1234" };

// TODO: 2단계에서 Supabase Auth로 교체 — supabase.auth.signInWithPassword() 호출로 대체
export function validateLogin(id: string, password: string): boolean {
  return id === MOCK_CREDENTIALS.id && password === MOCK_CREDENTIALS.password;
}

// TODO: 2단계에서 Supabase Auth로 교체 — profiles 테이블에서 name/role 조회로 대체
export function buildSessionUser(role: StaffRole): SessionUser {
  return role === "owner"
    ? { name: "김대표", role, roleLabel: "대표 · 관리자" }
    : { name: "이직원", role, roleLabel: "직원 · 열람 전용" };
}

// 직원(staff)이 접근할 수 없는 관리자 전용 경로 (FRD §1 권한 🔑)
export const ADMIN_ONLY_PATHS = ["/upload", "/inquiries", "/export", "/staff"];

export function isAdminOnlyPath(pathname: string) {
  return ADMIN_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}
