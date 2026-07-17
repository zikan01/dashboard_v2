// 매칭 규칙 단위 테스트 (TRD 핸드오프 §8 — 부분 일치·긴 키워드 우선·합집합·미등록 각 1건 이상)
import { describe, expect, it } from "vitest";
import {
  collectUnmatchedOptions,
  formatPreparationsForExport,
  matchOption,
  matchReservationOptions,
  normalizeText,
  type PreparationGroup,
} from "./preparation-match";

const group = (
  keyword: string,
  items: string[],
  is_active = true
): PreparationGroup => ({
  id: `id-${keyword}`,
  option_keyword: keyword,
  items,
  is_active,
});

describe("normalizeText", () => {
  it("공백 제거 + 소문자화", () => {
    expect(normalizeText(" 바베큐  세트 ")).toBe("바베큐세트");
    expect(normalizeText("BBQ Set")).toBe("bbqset");
  });
});

describe("matchOption — 부분 일치", () => {
  it('옵션 "바베큐 4인 세트"에 키워드 "바베큐" 준비물이 매칭된다 (FRD AC)', () => {
    const groups = [group("바베큐", ["고기", "숯", "집게"])];
    const m = matchOption("바베큐 4인 세트", groups);
    expect(m.matched).toBe(true);
    expect(m.keywords).toEqual(["바베큐"]);
    expect(m.items).toEqual(["고기", "숯", "집게"]);
  });

  it("공백·대소문자 차이를 무시하고 매칭한다", () => {
    const groups = [group("버스 왕복", ["차량 배차 확인"])];
    expect(matchOption("버스왕복 (성인)", groups).matched).toBe(true);
  });

  it("비활성(is_active=false) 키워드는 매칭에서 제외한다", () => {
    const groups = [group("바베큐", ["고기"], false)];
    expect(matchOption("바베큐 세트", groups).matched).toBe(false);
  });
});

describe("matchOption — 긴 키워드 우선", () => {
  it('"계곡"·"계곡체험" 동시 등록 시 옵션 "계곡 체험"에는 긴 키워드 것만 (FRD AC)', () => {
    const groups = [
      group("계곡", ["수건"]),
      group("계곡체험", ["구명조끼", "안전용품"]),
    ];
    const m = matchOption("계곡 체험", groups);
    expect(m.keywords).toEqual(["계곡체험"]);
    expect(m.items).toEqual(["구명조끼", "안전용품"]);
  });

  it('짧은 키워드만 매칭되는 옵션("계곡 물놀이")에는 짧은 키워드가 살아있다', () => {
    const groups = [group("계곡", ["수건"]), group("계곡체험", ["구명조끼"])];
    const m = matchOption("계곡 물놀이", groups);
    expect(m.keywords).toEqual(["계곡"]);
  });
});

describe("matchOption — 다중 매칭 합집합", () => {
  it("포함 관계가 아닌 키워드 여러 개가 매칭되면 준비물 합집합(중복 제거·순서 유지)", () => {
    const groups = [
      group("바베큐", ["고기", "숯", "장갑"]),
      group("숙박", ["침구", "수건", "장갑"]), // "장갑" 중복
    ];
    const m = matchOption("바베큐 숙박 패키지", groups);
    expect(m.keywords).toEqual(["바베큐", "숙박"]);
    expect(m.items).toEqual(["고기", "숯", "장갑", "침구", "수건"]);
  });
});

describe("미등록", () => {
  it("매칭되는 키워드가 없으면 matched=false, items 빈 배열", () => {
    const m = matchOption("샘물 트레킹", [group("바베큐", ["고기"])]);
    expect(m.matched).toBe(false);
    expect(m.items).toEqual([]);
  });

  it("collectUnmatchedOptions는 미등록 옵션만 중복 없이 모은다", () => {
    const groups = [group("바베큐", ["고기"])];
    const unmatched = collectUnmatchedOptions(
      ["바베큐 4인", "샘물 트레킹", "샘물트레킹", "매실 따기"],
      groups
    );
    expect(unmatched).toEqual(["샘물 트레킹", "매실 따기"]);
  });
});

describe("예약 단위 그룹 + 내보내기 형식", () => {
  const groups = [
    group("바베큐", ["고기", "숯"]),
    group("계곡체험", ["구명조끼"]),
  ];

  it("옵션별 결과를 옵션 단위로 유지한다 (합치지 않음)", () => {
    const results = matchReservationOptions(["바베큐 4인", "계곡 체험"], groups);
    expect(results).toHaveLength(2);
    expect(results[0].items).toEqual(["고기", "숯"]);
    expect(results[1].items).toEqual(["구명조끼"]);
  });

  it('내보내기 형식 "옵션명: 항목, 항목 / 옵션명: (미등록)" 준수 (FRD AC)', () => {
    const text = formatPreparationsForExport(
      ["바베큐 4인", "샘물 트레킹"],
      groups
    );
    expect(text).toBe("바베큐 4인: 고기, 숯 / 샘물 트레킹: (미등록)");
  });

  it("옵션이 없으면 빈 문자열", () => {
    expect(formatPreparationsForExport([], groups)).toBe("");
  });
});
