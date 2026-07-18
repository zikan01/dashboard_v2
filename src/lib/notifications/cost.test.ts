import { describe, expect, it } from "vitest";
import { estimateCost, eucKrByteLength, smsType } from "./cost";

describe("eucKrByteLength", () => {
  it("한글 2바이트, 영문·숫자 1바이트로 계산한다", () => {
    expect(eucKrByteLength("abc")).toBe(3);
    expect(eucKrByteLength("가나다")).toBe(6);
    expect(eucKrByteLength("가a1")).toBe(4);
  });
});

describe("smsType", () => {
  it("90바이트 이하는 SMS", () => {
    expect(smsType("가".repeat(45))).toBe("SMS"); // 90바이트
  });
  it("90바이트 초과는 LMS", () => {
    expect(smsType("가".repeat(46))).toBe("LMS"); // 92바이트
  });
});

describe("estimateCost", () => {
  it("기본 단가 SMS 18원 / LMS 45원", () => {
    expect(estimateCost("짧은 문자")).toBe(18);
    expect(estimateCost("가".repeat(46))).toBe(45);
  });
  it("설정 단가를 넘기면 그 값을 쓴다", () => {
    expect(estimateCost("짧은 문자", { smsCost: 20, lmsCost: 50 })).toBe(20);
  });
});
