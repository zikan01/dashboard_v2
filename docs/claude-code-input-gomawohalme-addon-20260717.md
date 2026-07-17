# Claude Code 구현 지시서 — 고마워할매 대시보드 추가기능 2건

> 작성일: 2026-07-17 · 용도: VSCode Claude Code(CLI) 입력 문서
> 범위: ① 옵션·준비물 수기 입력 ② 네이버 예약 엑셀 자동 다운로드+복호화 업로드
> **디자인 전면 적용은 이번 범위 아님** — 신규 화면만 아래 디자인 토큰 준수, 기존 화면 스타일 변경 금지

---

## 0. 시작하기 전에 읽을 문서 (순서대로)

1. `docs/trd-gomawohalme-addon-20260717-handoff.md` — 기술 결정·SQL·API 명세·개발 순서 (주 문서)
2. `docs/frd-gomawohalme-addon-20260717-handoff.md` — 화면 요소·검증 규칙·AC·파일 맵
3. `docs/prd-gomawohalme-addon-20260717-handoff.md` — 잠긴 결정·기능 카탈로그
4. 기존 코드 파악: `src/lib/excel.ts`(파서), `src/app/api/import/route.ts`(apply_import_plan RPC), `supabase/migrations/`

v2 문서 3종(`docs/*-v2-20260709*.md`)은 기존 시스템 이해용 참조. 충돌 시 증분 문서가 우선하되, **v2 필드 소유권 규칙(운영상태 덮어쓰기 금지)은 절대 유지**.

---

## 1. 확정된 실물 값 (2026-07-17 검증 완료)

아래 값은 실제 파일로 검증됐다. 추측하지 말고 그대로 사용할 것.

| 항목 | 값 | 검증 내용 |
|---|---|---|
| 엑셀 비밀번호 | `forest_unnie` | msoffcrypto로 복호화 성공 (표준 ooxml Agile Encryption) — **코드·git에 하드코딩 금지**, DB 암호화 저장(app_settings) 초기값으로만 사용 |
| 브라우저 | **Chrome** | 확정. `config.browser.channel = "chrome"` |
| 예약자관리 URL | `https://partner.booking.naver.com/bizes/1122869/booking` | 저장 페이지에서 확인 |
| 상세 내려받기 버튼 | 텍스트 기반 선택자 사용: `button:has-text("상세 내려받기")` | 클래스는 `btn btn-default BookingListView__control-btn__MLorG`이나 해시(MLorG)는 빌드마다 바뀔 수 있음 → **텍스트 선택자 채택**. 주의: 같은 클래스의 "내려받기" 버튼이 옆에 있으므로 정확히 "상세 내려받기" 텍스트 매칭 |
| 로그인 감지 | URL이 `nid.naver.com` 포함 시 로그인 필요로 판정 (보조: 페이지에 "로그아웃" 텍스트 부재) | |
| 다운로드 파일명 패턴 | `*_예약자관리_YYYYMMDD_HHMM.xlsx` → glob `*예약자관리*.xlsx` | 실파일명: `(주) 숲속언니들 농업회사법인_예약자관리_20260717_1638.xlsx` |
| 엑셀 구조 | 시트명 `Report`, 1~2행 안내문, **3행이 헤더**, 38열 | 옵션 컬럼명 = `가격분류 및 옵션` — 기존 파서가 `가격분류및옵션`으로 이미 매핑함 (`lib/excel.ts` HEADER_ALIASES) → **파서 수정 불필요, 검증만** |
| 샘플 파일 | `samples/(주) 숲속언니들...1638.xlsx` (암호화 원본), `samples/예약자관리_페이지.html` | `/samples`는 .gitignore 처리됨(실고객 개인정보 포함, **커밋 금지**) |

---

## 2. 구현 순서 (TRD 핸드오프 §9 기반, 검증 1단계는 완료됨)

```
✅ 0단계 (완료): 복호화 검증 — forest_unnie로 샘플 복호화 성공 확인됨 (2026-07-17)

1주차 — 복호화 업로드 경로
  1. supabase/migrations/0004_addon.sql: app_settings 테이블 + preparation_items 유니크 인덱스
     (TRD 핸드오프 §2 SQL 그대로. 칼럼명은 QA #4에 따라 value 사용 권장)
  2. src/lib/crypto.ts: AES-256-GCM encrypt/decrypt + sha256 (TRD §5)
  3. src/app/api/settings/route.ts: 비밀번호 저장/상태 조회/수집기 토큰 발급 (TRD §4.3)
  4. src/app/api/import/route.ts 확장: CFB 시그니처(D0 CF 11 E0) 감지 → officecrypto-tool 복호화
     → 평문 buffer를 기존 파서에 전달. mode=auto_apply 추가 (기존 apply_import_plan 그대로 호출)
  5. src/app/(dashboard)/upload/page.tsx: 비밀번호 설정 카드 (FRD 핸드오프 §3.2 E-A11~14)
  6. 샘플 파일로 통합 테스트: 암호화 파일 업로드 → 미리보기 도달 (FRD AC S-A02)

2주차 — 옵션·준비물
  7. src/app/api/preparations/route.ts: CRUD (TRD §4.2)
  8. src/lib/preparation-match.ts: 매칭 로직 + 단위 테스트 (부분일치·긴 키워드 우선·합집합·미등록)
  9. src/app/(dashboard)/options/page.tsx: 옵션 업로드 화면 (FRD §5.1, 요소 E-A01~A10)
 10. src/components/preparation-card.tsx + reservations/[id]/page.tsx에 1줄 삽입
 11. src/app/(dashboard)/export/page.tsx: "준비물" 필드 (형식: "옵션명: 항목, 항목 / 옵션명: (미등록)")
 12. src/components/layout/sidebar.tsx: ADMIN_NAV에 옵션 업로드 1줄 — 엑셀 업로드 바로 다음 (QA #2)

3주차 — 수집기 (웹앱과 독립 폴더)
 13. collector/ 신규 (별도 package.json): Node 20 + TS + playwright-core
 14. 6단계 파이프라인 (TRD §6): CDP 접속(127.0.0.1:9222, 실패 시 chrome을
     --remote-debugging-port --user-data-dir 전용 프로필로 실행) → URL 이동 → 로그인 감지 →
     button:has-text("상세 내려받기") 클릭 → 다운로드 폴더 감시(*예약자관리*.xlsx, 60초) →
     복호화 → POST /api/import (mode=auto_apply, Bearer 토큰)
 15. config.json (TRD §3 구조에 §1의 확정값 기입) + 바로가기 2개 + exe 패키징
 16. 로그: 개인정보 금지(건수만), collector/logs/, 30일 삭제
```

---

## 3. 반드시 지킬 제약

- **기존 화면 스타일·레이아웃 변경 금지** (협업자 합의). 수정 허용 파일은 FRD 핸드오프 §10 파일 맵의 6개뿐이며, 그중 `sidebar.tsx`·`reservations/[id]/page.tsx`는 각 1줄 삽입만.
- `lib/excel.ts`는 수정하지 않는 것이 목표 (복호화는 route에서 평문화 후 전달).
- `reservations` 테이블 스키마 변경 금지 (협업자 SOLAPI 발송 로직이 읽음).
- 비밀번호·토큰: 평문 저장 금지, API 응답에 값 미포함, 로그 출력 금지, git 커밋 금지.
- 협업자 담당 영역(자동안내설정·메시지 템플릿·솔라피 설정·발송 일정·발송 이력·실패 관리) 파일 생성·수정 금지.
- 신규 화면(옵션 업로드) 디자인 토큰: bg #F4F0E8 · 카드 #FCFAF5 · 테두리 #E7E2D6 · 딥그린 #1F5C43/#2E7D5B · Pretendard, 기존 컴포넌트(`components/ui/*`) 재사용 우선.

## 4. 완료 판정

FRD 핸드오프 §5의 AC 전체 통과 + TRD 핸드오프 §8 보안 체크리스트 전체 확인.
특히 회귀 2건 필수: 비암호화 엑셀 업로드 기존과 동일 동작, auto_apply가 운영상태(reservation_manual_statuses) 무변경.

## 5. 사람이 할 일 (Claude Code 범위 밖)

- Vercel 환경변수 등록: `SETTINGS_ENCRYPTION_KEY` (openssl rand -base64 32)
- Supabase에 0004 마이그레이션 적용
- 배포 후 설정 카드에서 비밀번호(forest_unnie) 등록 + 수집기 토큰 발급 → 대표 PC config.json에 기입
- 대표 PC에 collector.exe + 바로가기 설치, 첫 실행 입회 테스트
