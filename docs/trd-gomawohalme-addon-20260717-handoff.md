# 고마워할매 대시보드 추가기능 TRD - AI 입력용 핸드오프 팩

> 본문: `trd-gomawohalme-addon-20260717.md`
> 사용처: Claude Code 시스템 프롬프트, 개발 착수 자료
> 기준: v2 TRD 핸드오프의 스키마·RLS·아키텍처 정의 우선. 본 팩은 증분만.

---

## 1. 잠긴 결정 (기술)

- 수집기: Node 20 + TypeScript + **playwright-core** (브라우저 미내장), CDP(127.0.0.1)로 기존 브라우저 연결
- 배포: 단일 `collector.exe` (Node SEA 또는 yao-pkg 패키징 — 빌드 시 확정) + `config.json` + 바로가기 2개
- 복호화: **officecrypto-tool** (npm) — 웹 `/api/import`·수집기 공용. **개발 1일차 실파일 검증 필수**
- 비밀번호 저장: AES-256-GCM, 키는 `SETTINGS_ENCRYPTION_KEY` (Vercel env, 32바이트 base64)
- 수집기 인증: 전용 토큰 (서버 발급, DB에는 SHA-256 해시만, 권한=auto_apply 업로드 단일)
- auto_apply: **기존 반영 로직 그대로 호출** (미리보기 확인만 생략) → v2 필드 소유권 규칙(운영상태 덮어쓰기 금지) 자동 준수
- 매칭: 조회 시 계산, `lib/preparation-match.ts` 단일 모듈 + 단위 테스트
- 기존 스택 변경: 없음 (Next.js 14·Supabase·Vercel·SheetJS 유지)

## 2. 데이터 스키마 (증분 SQL — 신규 마이그레이션 `0004_addon.sql`)

```sql
-- 관리자 설정 (비밀번호 암호문, 수집기 토큰 해시)
CREATE TABLE app_settings (
  key text PRIMARY KEY,               -- 'excel_file_password' | 'collector_token_hash'
  value_encrypted text NOT NULL,      -- 형식이 key마다 다름(QA #4): 비밀번호=AES-256-GCM 암호문(iv:tag:cipher b64, 복호화 가능) / 토큰=sha256 hex(해시, 복원 불가). 구현 시 칼럼명 `value` 권고
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_settings_owner_only ON app_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  );

-- 준비물 중복 등록 방지 (기존 테이블에 인덱스만 추가)
CREATE UNIQUE INDEX uq_preparation_items_keyword_item
  ON preparation_items (business_id, option_keyword, item_name);
```

주의: `app_settings` 접근은 서버 라우트에서 service role로 수행하고 RLS는 이중 방어. 클라이언트에서 직접 조회 금지.

## 3. 환경변수 (증분)

```bash
# .env.local / Vercel 환경변수 추가분
SETTINGS_ENCRYPTION_KEY=   # openssl rand -base64 32
# 기존 SUPABASE_* 변수는 v2 그대로
```

```jsonc
// collector/config.json (배포 시 대표 PC에 설치)
{
  "apiBaseUrl": "https://<배포 도메인>",
  "collectorToken": "<발급 토큰 원문>",
  "browser": {
    "channel": "chrome",              // 착수 시 확정: "chrome" | "whale"
    "executablePath": "",             // whale일 경우 명시
    "debugPort": 9222,
    "profileDir": "%LOCALAPPDATA%\\GomawoCollector\\profile"
  },
  "download": {
    "dir": "%USERPROFILE%\\Downloads",
    "filePattern": "TBD-첫-실행-시-확인.xlsx",   // 미해결: 실제 파일명 패턴
    "timeoutSec": 60
  },
  "selectors": {
    "reserveMenu": "TBD",             // 좌측 '예약' 메뉴
    "detailDownloadBtn": "TBD",       // '상세 내려받기' 버튼
    "loginDetect": "TBD"              // 로그인 화면 감지
  },
  "period": { "basis": "이용일", "range": "한달" }
}
```

## 4. API 명세 (증분)

### 4.1 POST /api/import (확장)

```
입력: multipart file (기존 동일) + mode?: 'preview'(기본, 기존 동작) | 'auto_apply'
인증: preview = 기존 관리자 세션 / auto_apply = Bearer <collector_token> 또는 관리자 세션
처리:
  1. 파일 앞 8바이트가 CFB 시그니처(D0 CF 11 E0 ...)면 암호화 파일로 판정
  2. app_settings.excel_file_password 복호화 → officecrypto-tool로 해제 → 평문 buffer를 기존 파서에 전달
     (미등록: 400 {error:'password_not_set'} / 불일치: 400 {error:'password_mismatch'})
  3. mode=auto_apply: 기존 "반영" 로직 직접 호출 (필드 소유권 규칙 그대로) →
     import_batches source='local_collector', status='applied' 기록
출력: { batchId, total, new, updated, skipped } 또는 { error }
```

### 4.2 /api/preparations (신규)

```
GET    → [{id, option_keyword, items:[..], is_active}]  (로그인 필수)
POST   {option_keyword, items[]}       (owner) — 정규화 후 중복 keyword → 409 {error:'duplicate', existingId}
PATCH  {id, items[]|option_keyword|is_active} (owner) — 병합은 클라이언트가 합집합 계산 후 PATCH
DELETE {id}                            (owner)
저장 구조: 1행 = keyword+item 단위(v2 스키마 그대로) — API가 keyword 기준 그룹핑해 응답
```

### 4.3 /api/settings (신규, 전부 owner)

```
GET  → { passwordSet: boolean, tokenIssuedAt: string|null }   (값 자체는 절대 반환 안 함)
POST { password }        → AES-256-GCM 암호화 저장
POST { issueToken: true } → 32바이트 랜덤 토큰 생성 → 해시 저장 → 원문 1회만 응답 (재조회 불가)
```

## 5. 암호화 구현 (의사코드)

```ts
// lib/crypto.ts
encrypt(plain): iv(12B 랜덤) → AES-256-GCM(key=env) → `${b64(iv)}:${b64(tag)}:${b64(cipher)}`
decrypt(stored): 역순. 실패 시 null (에러 메시지에 원문 흔적 금지)
hashToken(t): sha256(t) hex
```

## 6. 수집기 실행 흐름 (구현 순서)

```
1. config 로드 → 2. CDP 접속 시도 (http://127.0.0.1:{port}/json/version)
   실패 → 브라우저를 --remote-debugging-port={port} --user-data-dir={profileDir}로 실행 후 재시도
   ("브라우저 열기" 바로가기 = 같은 명령. 수집 전용 프로필 분리 — 상시 브라우저와 격리)
3. playwright-core chromium.connectOverCDP()
4. partner.booking.naver.com 예약자관리 이동 → loginDetect 매칭 시 안내 후 종료(exit 2)
5. 기간 확인(기본값이면 조작 없음) → detailDownloadBtn 클릭
6. download.dir 감시: 클릭 시각 이후 생성 + filePattern 매칭 .xlsx, timeoutSec 대기
7. officecrypto-tool 복호화 (실패 → 안내 후 종료, 원본 보존)
8. POST /api/import (mode=auto_apply, Bearer token)
9. 결과 출력 → 로그 파일 기록 (이름·전화번호 등 개인정보 금지, 건수만) → 종료 코드 0/1
```

## 7. 신규·수정 파일 맵 (FRD 핸드오프 §10 상속 + 수집기 상세)

```
collector/                     # 웹앱과 독립 (package.json 별도)
├── src/index.ts               # 6단계 파이프라인
├── src/decrypt.ts             # officecrypto-tool 래퍼 (웹과 로직 공유 불가 시 복제 허용)
├── config.json                # §3
└── build: esbuild → SEA/yao-pkg → collector.exe

웹앱 수정: api/import/route.ts(복호화+auto_apply) · sidebar.tsx(1줄) ·
reservations/[id]/page.tsx(1줄) · export/page.tsx · upload/page.tsx
웹앱 신규: options/page.tsx · components/preparation-card.tsx ·
lib/preparation-match.ts · lib/crypto.ts · api/preparations/route.ts · api/settings/route.ts
```

## 8. NFR·보안 체크리스트

- [ ] 비밀번호·토큰: 평문 저장 금지, GET 응답에 값 미포함, 로그 출력 금지
- [ ] 수집기: 네이버 자격증명 저장·입력 코드 없음
- [ ] 디버그 포트 127.0.0.1 전용 + 전용 프로필
- [ ] 수집기 로그: 개인정보 금지(건수만), 30일 자동 삭제
- [ ] auto_apply가 reservation_manual_statuses(운영상태)를 건드리지 않음 — 회귀 테스트
- [ ] preparation-match.ts 단위 테스트: 부분 일치·긴 키워드 우선·합집합·미등록 각 1건 이상
- [ ] 복호화 +2초 이내, 매칭 +100ms 이내 (PRD NFR)

## 9. 개발 순서 (3주)

```
1일차   : [최우선] 실제 네이버 엑셀로 officecrypto-tool 복호화 검증 (HIGH-1)
1주차   : app_settings 마이그레이션 → lib/crypto → /api/settings → /api/import 복호화 →
          업로드 화면 설정 카드 (여기까지로 "비밀번호 에러 제거" 가치 선출시 가능)
2주차   : /api/preparations → 옵션 업로드 화면 → preparation-match + 단위 테스트 →
          상세 PreparationCard → 내보내기 필드
3주차   : 수집기 (CDP 연결 → 클릭 → 감시 → 업로드) → 대표 PC 실기 테스트(브라우저 확정·
          선택자/파일 패턴 확인) → 토큰 발급 UI → 통합 테스트
병행    : sidebar.tsx 병합 순서 협업자와 합의
```

## 10. 미해결 (착수 시 확인 3건 — 전부 실물 확인 값)

1. 엑셀 비밀번호 원문 (대표 전달)
2. 브라우저 확정: chrome | whale (스크린샷상 웨일 추정) → config.browser
3. 다운로드 파일명 패턴 + 실제 선택자 3종 → config에 기입

## 11. 협업자 접점 (요약)

sidebar.tsx 1줄(병합 순서 합의) · 예약 상세는 컴포넌트 1줄 삽입으로 충돌 최소화 ·
reservations 테이블 스키마 변경 없음(협업자 발송 로직 영향 0) · SOLAPI 6페이지 범위 침범 없음

## 12. 다음 단계

project-qa (최종 검수): 증분 문서 6종 + v2 문서 3종 + 기존 코드 크로스체크
