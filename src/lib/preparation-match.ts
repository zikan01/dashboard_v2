// 옵션 ↔ 준비물 매칭 (PRD 핸드오프 §3.3 확정 규칙 — 조회 시 계산, 관계 저장 안 함)
//
//   normalize(s) = lower(remove_spaces(s))
//   옵션 1건: active 준비물 중 normalize(옵션명)이 normalize(키워드)를 "포함"하면 후보
//             포함 관계 중복(예: "계곡" ⊂ "계곡체험") → 가장 긴 키워드 1개만 채택
//             서로 무관한 다중 매칭 → 준비물 합집합 (중복 제거, 순서 유지)
//   예약 1건: 옵션별 결과를 옵션 단위로 그룹 표시 (합치지 않음)
//   내보내기: "옵션명: 항목, 항목 / 옵션명: (미등록)"
//
// 서버(API)·클라이언트(화면) 공용 — 부수효과 없는 순수 함수만 둔다.

export interface PreparationGroup {
  id: string;
  option_keyword: string;
  items: string[];
  is_active: boolean;
}

export interface OptionMatch {
  optionName: string;
  matched: boolean;
  keywords: string[]; // 채택된 키워드 (긴 키워드 우선 규칙 적용 후)
  items: string[]; // 합집합 (중복 제거, 키워드 등록 순서 유지)
}

export const normalizeText = (s: string) => s.replace(/\s+/g, "").toLowerCase();

// 옵션 1건 매칭
export function matchOption(
  optionName: string,
  groups: PreparationGroup[]
): OptionMatch {
  const n = normalizeText(optionName);
  let candidates = groups.filter((g) => {
    if (!g.is_active) return false;
    const key = normalizeText(g.option_keyword);
    return key.length > 0 && n.includes(key);
  });

  // 포함 관계 중복 제거: 다른 후보의 키워드에 포함되는(더 짧은) 키워드는 버린다
  candidates = candidates.filter((g) => {
    const key = normalizeText(g.option_keyword);
    return !candidates.some((other) => {
      if (other === g) return false;
      const otherKey = normalizeText(other.option_keyword);
      return otherKey.length > key.length && otherKey.includes(key);
    });
  });

  const items: string[] = [];
  for (const g of candidates) {
    for (const item of g.items) {
      if (!items.includes(item)) items.push(item); // 합집합, 순서 유지
    }
  }

  return {
    optionName,
    matched: candidates.length > 0,
    keywords: candidates.map((g) => g.option_keyword),
    items,
  };
}

// 예약 1건: 옵션별 결과 (옵션 단위 그룹 — 합치지 않음)
export function matchReservationOptions(
  options: string[],
  groups: PreparationGroup[]
): OptionMatch[] {
  return options.map((o) => matchOption(o, groups));
}

// 내보내기 "준비물" 필드 형식: "옵션명: 항목, 항목 / 옵션명: (미등록)"
export function formatPreparationsForExport(
  options: string[],
  groups: PreparationGroup[]
): string {
  return matchReservationOptions(options, groups)
    .map((m) =>
      m.matched ? `${m.optionName}: ${m.items.join(", ")}` : `${m.optionName}: (미등록)`
    )
    .join(" / ");
}

// 미등록 옵션 집계 (S-A01 Tier 2 카드) — 예약들의 옵션 중 매칭 실패한 옵션명 목록
export function collectUnmatchedOptions(
  allOptions: string[],
  groups: PreparationGroup[]
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const option of allOptions) {
    const key = normalizeText(option);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!matchOption(option, groups).matched) result.push(option);
  }
  return result;
}
