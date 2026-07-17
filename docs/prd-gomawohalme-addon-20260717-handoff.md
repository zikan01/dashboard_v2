# 고마워할매 대시보드 추가기능 PRD - AI 입력용 핸드오프 팩

> 본문: `prd-gomawohalme-addon-20260717.md`
> 기준: v2 문서 3종 (`prd/frd/trd-gomawohalme-reservation-dashboard-v2-20260709`) — 본 팩은 증분만 기술, 기존 정의는 v2 핸드오프 우선
> 사용처: frd-writer 입력, Claude Code 시스템 프롬프트
> 성격: 정밀 데이터 카탈로그. 필요한 섹션을 부분 참조한다.

---

## 1. 잠긴 결정 (Locked Decisions)

- 범위: 사용자(Dong ho) 담당분만 — 옵션 준비물, 복호화, 수집기. **SOLAPI 발송 6페이지(자동안내설정·메시지 템플릿·솔라피 설정·발송 일정·발송 이력·실패 관리)는 협업자 담당으로 범위 제외. 후기·만족도·사진 발송 미구현.**
- 기존 작업물 원칙: 협업자 합의사항에 따라 기존 페이지 디자인 변경 금지. 기능 추가는 확장만.
- 수집기 아키텍처: **독립 실행형** (실행 환경에 Claude·AI 도구 없음 전제). Node.js + Playwright.
- 로그인: **자동화하지 않음.** 대표가 디버그 모드 바로가기로 연 브라우저에 수동 로그인 → 수집기가 CDP(Chrome DevTools Protocol, 실행 중인 브라우저에 접속하는 표준 통로)로 연결.
- 버튼 탐색: 이미지 인식 금지, **페이지 요소(DOM) 기반.** 선택자는 설정 파일로 분리.
- 다운로드 대상: 예약자관리(partner.booking.naver.com) 우측 상단 **"상세 내려받기"** ("내려받기" 아님).
- 조회 기간: 이용일 기준 **한 달** (기본값 고정).
- 복호화: 엑셀 파일 비밀번호는 **매번 동일** → 관리자 설정에 1회 등록, 웹 업로드·수집기 양쪽에서 자동 적용.
- 매칭 규칙: `preparation_items.option_keyword`가 예약 옵션 텍스트에 **부분 일치(정규화: 공백 제거·소문자화)**하면 매칭. 가장 긴 키워드 우선, 다중 매칭 시 준비물 합집합.
- 매칭 저장: 관계를 저장하지 않고 **조회 시 계산** (준비물 수정이 과거 예약에 즉시 반영).
- DB: 신규 테이블은 `app_settings` 1개만. 준비물은 v2 정의 `preparation_items` 재사용.
- 필수 기능: A-001~A-008 (8개) / 선택: A-009~A-010 (2개) / 후순위: A-011~A-012 (2개)

---

## 2. 기능 카탈로그 (전체 ID)

### 2.1 옵션 준비물 (화면: 옵션 업로드 S-A01, 예약 상세, 내보내기)

| ID | 기능명 | 분류 | 화면 | 왜 필요 | Empty | Loading | Error |
|---|---|---|---|---|---|---|---|
| A-001 | 준비물 등록 (옵션명+준비물 쉼표 입력) | 필수 | S-A01 | 고정 예시 표(v2 FRD §8) 대체 | 입력 폼만 표시 | 저장 중 버튼 비활성 | 중복 옵션명 경고 |
| A-002 | 준비물 목록 조회·수정·삭제 | 필수 | S-A01 | 옵션 변경 대응 | "등록된 옵션이 없습니다" + 안내 | 스켈레톤 | 재시도 버튼 |
| A-003 | 예약 상세 준비물 표시 (매칭 계산) | 필수 | 예약 상세 | 준비물 누락 방지 | "준비물 미등록" + S-A01 링크 | 카드 스켈레톤 | 매칭 실패 시 옵션 원문만 표시 |
| A-004 | 내보내기 준비물 필드 | 필수 | 데이터 내보내기 | 오프라인 활용 | 필드 선택 안 하면 미포함 | 기존 내보내기와 동일 | 기존 내보내기와 동일 |
| A-009 | 미등록 옵션 목록 표시 | 선택 | S-A01 | 등록 누락 발견 | "모든 옵션 등록됨" | 스켈레톤 | 생략 가능 |

### 2.2 복호화 (화면: 엑셀 업로드, API)

| ID | 기능명 | 분류 | 화면 | 왜 필요 | Empty | Loading | Error |
|---|---|---|---|---|---|---|---|
| A-005 | 암호화 엑셀 자동 복호화 | 필수 | /api/import | 업로드 에러 제거 | — | 업로드 진행 표시 | "파일 비밀번호가 맞지 않습니다" |
| A-006 | 파일 비밀번호 설정 (관리자) | 필수 | 엑셀 업로드 내 설정 카드 | 비밀번호 1회 등록 | "비밀번호 미등록" 상태 표시 | 저장 중 | 저장 실패 재시도 |

### 2.3 수집기 (웹 화면 아님 — 대표 PC 프로그램)

| ID | 기능명 | 분류 | 화면 | 왜 필요 | Empty | Loading | Error |
|---|---|---|---|---|---|---|---|
| A-007 | 브라우저 연결→상세 내려받기 자동 클릭 | 필수 | 수집기 | 다운로드 자동화 | — | 단계별 로그 출력 | 세션 만료: "로그인 후 재실행" 안내 |
| A-008 | 파일 감지→복호화→업로드 API 호출 | 필수 | 수집기 | 갱신 전자동화 | — | 진행 로그 | 실패 사유 표시 + 원본 보존 |
| A-010 | 감시 폴더 수동 투입 폴백 | 선택 | 수집기 | 자동화 실패 대비 | — | — | — |
| A-011 | 정시 자동 실행 | 후순위 | 수집기 | 무인화 | — | — | — |
| A-012 | 미등록 옵션 업로드 시 알림 | 후순위 | — | 협업자 알림 인프라 접점 | — | — | — |

> 본문 §5.2에 자연어 설명. 협업자 담당 기능은 본 카탈로그에 없음.

---

## 3. 데이터 스키마 (SQL)

### 3.1 기존 재사용 (v2 TRD 핸드오프 §스키마 정의 그대로 — 변경 금지)

```sql
-- 이미 정의됨 (v2): preparation_items
CREATE TABLE preparation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  option_keyword text NOT NULL,
  item_name text NOT NULL,
  note text,
  is_active boolean NOT NULL DEFAULT true
);
```

증분 변경: 없음. 단, FRD에서 `UNIQUE (business_id, option_keyword, item_name)` 추가 여부 결정 (중복 등록 방지).

### 3.2 신규 테이블

```sql
-- 관리자 설정 (엑셀 파일 비밀번호 등)
CREATE TABLE app_settings (
  key text PRIMARY KEY,                -- 'excel_file_password'
  value_encrypted text NOT NULL,       -- 서버측 암호화 후 저장 (암호화 방식 TRD 결정)
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_admin_only ON app_settings
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'owner')
  );
```

### 3.3 매칭 로직 (SQL 아님 — 조회 시 계산, 의사코드)

```
normalize(s) = lower(replace(s, ' ', ''))
matched(reservation) =
  for each option_name in reservation.options:
    keywords = preparation_items where is_active
               and normalize(option_name) contains normalize(option_keyword)
    if 포함 관계 키워드 중복 → 가장 긴 키워드 채택
  return union(item_name grouped by option_keyword)
```

---

## 4. AI 호출 프롬프트

해당 없음 (이번 증분에 LLM 호출 기능 없음).

---

## 5. 비기능 요구사항 (NFR) — 수치

| 항목 | 요구사항 | 측정 방법 |
|---|---|---|
| 수집기 전체 소요 | 실행→업로드 완료 3분 이내 (예약 100건 기준, 추정) | 수집기 로그 타임스탬프 |
| 복호화 추가 지연 | 업로드 처리 +2초 이내 | API 처리 시간 로그 |
| 매칭 계산 | 예약 상세 렌더 +100ms 이내 (등록 옵션 50개 기준) | 클라이언트 계측 |
| 보안 - 비밀번호 | 평문 저장 금지, 관리자 외 조회 불가 | RLS 정책 + 코드 리뷰 |
| 보안 - 네이버 계정 | 수집기에 네이버 자격증명 저장 금지 | 코드 리뷰 |
| 호환성 | 수집기: Windows 11, 크롬·웨일(크로미움) 지원 | 대표 PC 실기 테스트 |

---

## 6. 화면 ID 카탈로그

| 화면 ID | 화면명 | URL | 분류 | 권한 | 비고 |
|---|---|---|---|---|---|
| S-A01 | 옵션 업로드 | /options | 신규 | 관리자 | 사이드바 "데이터" 그룹, 엑셀 업로드와 텍스트 문의 사이 |
| S-A02 | 엑셀 업로드 (확장) | /upload | 기존 확장 | 관리자 | 비밀번호 설정 카드 + 암호화 파일 자동 처리 |
| S-A03 | 예약 상세 (확장) | /reservations/[id] | 기존 확장 | 전체 | 준비물 영역 — 협업자의 자동안내 탭과 별개 영역 |
| S-A04 | 데이터 내보내기 (확장) | /export | 기존 확장 | 관리자 | 필드 선택에 "준비물" 추가 |
| — | 수집기 | (웹 아님) | 신규 프로그램 | 대표 PC | 최소 UI(텍스트 로그 창), v3 디자인 토큰 미적용 |

디자인: v3 시안(`고마워할매_대시보드_v3_공유용.html`) 토큰 준수 — bg #F4F0E8 / 카드 #FCFAF5 / 딥그린 #1F5C43 / 배지 5종(색+아이콘+텍스트) / Pretendard 스케일(22·16·14.5·13·11.5).

---

## 7. 외부 통합 상세

| 서비스 | 용도 | 인증 방식 | 비용 모델 | 한도 | 마이그레이션 난이도 |
|---|---|---|---|---|---|
| 네이버 스마트플레이스 | 상세 엑셀 다운로드 (화면 자동화) | 대표 수동 로그인 세션 | 무료 | 공식 API 아님 — 화면 개편 리스크 | 중 (선택자 설정 파일로 완화) |

---

## 8. 미해결 / FRD·TRD에서 결정할 항목

- **수집기→API 인증 방식** (적대적 검토 HIGH-1): service key 금지 전제로 전용 토큰 방식 → **TRD 최우선 결정**
- **다운로드 파일 식별 규칙**: 파일명 패턴 + 시각 조건 → FRD에서 정의, 패턴 값은 첫 실행 시 확인
- **비밀번호 암호화 방식** (서버측): → TRD에서 결정
- **preparation_items UNIQUE 제약 추가 여부**: → FRD에서 결정

착수 시 사용자에게 확인할 값 3개: ① 엑셀 비밀번호 ② 브라우저 확정(크롬/웨일) ③ 실행 방식(아이콘 클릭 확정, 정시 실행은 후순위 A-011)

---

## 9. FRD 작성 시 사용할 핵심 변수

| 변수 | 값 |
|---|---|
| 화면 목록 | S-A01(신규) + S-A02~04(기존 확장) + 수집기 |
| 필수 기능 목록 | A-001 ~ A-008 |
| DB 변경 | app_settings 신규 1개, preparation_items 재사용 |
| 매칭 규칙 | 본 파일 §3.3 그대로 사용 |
| NFR 수치 | 본 파일 §5 그대로 사용 |
| 수정 대상 기존 파일 | `lib/excel.ts`(파싱 접점), `app/api/import/route.ts`(복호화), `reservations/[id]/page.tsx`(준비물 표시), `export/page.tsx`(필드), `components/layout/sidebar.tsx`(메뉴 1줄) |
| 신규 파일 | `app/(dashboard)/options/page.tsx`, `app/api/preparations/route.ts`, `app/api/settings/route.ts`, 수집기 저장소(웹앱과 별도 폴더 `collector/`) |

---

## 10. AI 바이브코딩 호환성 체크

- [x] 기능 ID 명확히 부여 (A-001 ~ A-012)
- [x] 각 기능의 입력/출력 추론 가능
- [x] 화면 상태(Empty/Loading/Error) 필수 기능 전체 정의
- [x] 권한 매트릭스 명확 (관리자 전용 표기)
- [x] DB 스키마 SQL 포함
- [ ] AI 프롬프트: 해당 없음
- [x] 기존 파일 vs 신규 파일 구분 명시 (§9)

---

## 11. 다음 스킬 호출

**다음 단계**: frd-writer
**입력**: ① 본 핸드오프 ② 본문 `prd-gomawohalme-addon-20260717.md` ③ v2 FRD (기존 화면 정의 참조용)
