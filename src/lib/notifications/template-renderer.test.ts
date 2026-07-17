import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template-renderer";

describe("renderTemplate", () => {
  it("변수를 값으로 치환한다", () => {
    const r = renderTemplate("#{고객명}님, #{방문일} 방문 안내드립니다.", {
      고객명: "김민지",
      방문일: "2026년 8월 20일 (목)",
    });
    expect(r.text).toBe("김민지님, 2026년 8월 20일 (목) 방문 안내드립니다.");
    expect(r.missing).toEqual([]);
  });
  it("값이 없는 변수는 원문 유지 + missing 보고", () => {
    const r = renderTemplate("#{고객명}님 #{인원}명", { 고객명: "김민지" });
    expect(r.text).toBe("김민지님 #{인원}명");
    expect(r.missing).toEqual(["인원"]);
  });
  it("변수가 없으면 원문 그대로", () => {
    const r = renderTemplate("안녕하세요.", {});
    expect(r.text).toBe("안녕하세요.");
    expect(r.missing).toEqual([]);
  });
});
