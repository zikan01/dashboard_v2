import { describe, expect, it } from "vitest";
import { isValidMobile, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("하이픈·공백을 제거하고 숫자만 남긴다", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone(" 010 1234 5678 ")).toBe("01012345678");
  });
});

describe("isValidMobile", () => {
  it("정상 휴대전화 형식을 통과시킨다", () => {
    expect(isValidMobile("010-1234-5678")).toBe(true);
    expect(isValidMobile("01112345678")).toBe(true); // 10자리
  });
  it("네이버 마스킹 값을 거부한다", () => {
    expect(isValidMobile("******4158")).toBe(false);
    expect(isValidMobile("010-****-5678")).toBe(false);
  });
  it("빈 값·자릿수 오류·유선번호를 거부한다", () => {
    expect(isValidMobile("")).toBe(false);
    expect(isValidMobile("010-1234")).toBe(false);
    expect(isValidMobile("02-123-4567")).toBe(false);
  });
});
