# 고마워할매 예약 운영 대시보드

네이버 스마트플레이스 예약 데이터를 기반으로 예약 현황·준비 알림·정산 상태를 관리하는 내부 운영 대시보드.

- 사양: `docs/trd-gomawohalme-reservation-dashboard-v2-20260709-handoff.md` (최우선 기준)
- 기능 정의: `docs/prd-...-v2-20260709.md`, `docs/frd-...-v2-20260709.md`
- 디자인 원본: `docs/고마워할매_대시보드_프로토타입_v2.html`, `docs/대시보드1~7.png`

## 실행

```bash
npm install
npm run dev    # http://localhost:3000
```

## 현재 상태: 1단계 (프론트엔드 + 목업 데이터)

- Supabase 미연동 — 모든 데이터는 `src/lib/mock-data.ts`에서 공급 (기준일 `MOCK_TODAY` = 2026-07-09)
- 로그인은 목업 (아무 이메일/비밀번호로 통과)
- 화면: 로그인 · 대시보드 홈(KPI 5종/오늘·다가오는 예약/준비 알림/최근 반영 상태) · 예약 목록 · 예약 상세 · 캘린더 · 엑셀 업로드+미리보기 · 텍스트 문의 · 데이터 내보내기(실제 xlsx 다운로드 동작) · 업로드 이력 · 직원 관리

## 2단계 (예정): Supabase 연동

TRD 핸드오프 §3~§7 기준으로 진행:

1. Supabase 프로젝트 생성 (서울 리전) + `.env` 구성 (§5)
2. DB 스키마·RLS·인덱스 적용 (§3.2~3.4), Prisma 도입
3. Supabase Auth 로그인/역할(owner/staff) 연동
4. `src/lib/mock-data.ts` 소비처를 서버 조회로 교체 (`src/lib/types.ts`는 DB 스키마와 1:1 매핑되어 있음)
5. 엑셀 업로드 SheetJS 실파싱 + 병합 규칙(§3.7) + 필드 소유권 규칙(§3.6: 정산·세금·메모 덮어쓰기 금지)

## 구조

```
src/
├─ app/
│  ├─ login/                  # 로그인 (목업)
│  └─ (dashboard)/            # 사이드바+톱바 공통 레이아웃
│     ├─ page.tsx             # 대시보드 홈
│     ├─ reservations/        # 목록 + [id] 상세
│     ├─ calendar/ upload/ inquiries/ export/ history/ staff/
├─ components/
│  ├─ ui/                     # Badge·Button·Card·Chip·Input (프로토타입 스타일)
│  └─ layout/                 # Sidebar·Topbar
└─ lib/
   ├─ types.ts                # TRD §3 스키마 1:1 타입 + 한글 라벨
   ├─ mock-data.ts            # 목업 데이터 (2단계에서 교체 대상)
   └─ utils.ts                # 마스킹·₩포맷·D-day·KPI 계산(취소 제외)
```

## 도메인 규칙 (코드에 반영됨)

- KPI "이번 달 예약"은 **취소 제외(확정+변경)** 기준
- 모든 예약에 표시번호(`GMW-YYMMDD-NNN`)와 출처(엑셀/수집기/텍스트문의) 표기
- 목록 연락처는 마스킹(`010-****-5678`), 상세는 전체 표시
- 메모는 **문자열**로만 저장·표시 (`[object Object]` 버그 방지)
- 정산·세금계산서·메모는 Supabase 소유 — 엑셀 재업로드로 덮어쓰지 않음
