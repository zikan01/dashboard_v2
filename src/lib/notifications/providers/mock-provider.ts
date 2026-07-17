// 테스트·개발용 Mock Provider — 외부 호출 없이 발송 흐름을 검증한다
import type { MessageProvider, ProviderSendResult } from "./message-provider";

export interface MockProvider extends MessageProvider {
  sent: Array<{ to: string; from: string; text: string }>;
}

export function createMockProvider(opts: { failWith?: string } = {}): MockProvider {
  const sent: MockProvider["sent"] = [];
  let seq = 0;
  return {
    sent,
    async sendSms(input): Promise<ProviderSendResult> {
      if (opts.failWith) {
        return { ok: false, errorCode: opts.failWith, errorMessage: "mock failure" };
      }
      sent.push(input);
      seq += 1;
      return {
        ok: true,
        providerMessageId: `MOCK-${seq}`,
        providerGroupId: "MOCK-GROUP-1",
        messageType: input.text.length > 45 ? "LMS" : "SMS",
      };
    },
    async getMessageStatus() {
      return { status: "delivered" as const };
    },
    async getBalance() {
      return 100000;
    },
  };
}
