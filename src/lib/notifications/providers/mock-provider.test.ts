import { describe, expect, it } from "vitest";
import { createMockProvider } from "./mock-provider";

describe("createMockProvider", () => {
  it("성공 모드: 보낸 메시지를 기록하고 성공을 돌려준다", async () => {
    const mock = createMockProvider();
    const r = await mock.sendSms({ to: "01012345678", from: "0311234567", text: "안녕" });
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toBeTruthy();
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0].to).toBe("01012345678");
  });
  it("실패 모드: errorCode를 돌려준다", async () => {
    const mock = createMockProvider({ failWith: "InsufficientBalance" });
    const r = await mock.sendSms({ to: "01012345678", from: "0311234567", text: "안녕" });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("InsufficientBalance");
    expect(mock.sent).toHaveLength(0);
  });
});
