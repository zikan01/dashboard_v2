// SOLAPI Provider (TRD §16) — solapi SDK 5.5.1
import { SolapiMessageService } from "solapi";
import type { MessageProvider, ProviderSendResult } from "./message-provider";

export function createSolapiProvider(): MessageProvider {
  const svc = new SolapiMessageService(
    process.env.SOLAPI_API_KEY!,
    process.env.SOLAPI_API_SECRET!
  );
  return {
    async sendSms({ to, from, text }): Promise<ProviderSendResult> {
      try {
        // SDK가 본문 길이에 따라 SMS/LMS를 자동 판별한다
        const res: any = await svc.send({ to, from, text });
        const first = res?.messageList?.[0] ?? {};
        return {
          ok: true,
          providerGroupId: res?.groupInfo?.groupId ?? res?.groupId,
          providerMessageId: first.messageId,
          messageType: first.type,
        };
      } catch (e: any) {
        return {
          ok: false,
          errorCode: e?.errorCode ?? e?.name ?? "SEND_ERROR",
          errorMessage: e?.errorMessage ?? e?.message ?? String(e),
        };
      }
    },
    async getMessageStatus(providerMessageId) {
      try {
        const res: any = await svc.getMessages({ messageId: providerMessageId });
        const msg = res?.messageList?.[0] ?? res?.[0];
        const code: string | undefined = msg?.statusCode;
        if (!code) return { status: "unknown" };
        if (code === "4000") return { status: "delivered" };
        if (code.startsWith("2") || code.startsWith("3")) return { status: "pending" };
        return { status: "failed", errorCode: code };
      } catch {
        return { status: "unknown" };
      }
    },
    async getBalance() {
      const res: any = await svc.getBalance();
      return Number(res?.balance ?? 0);
    },
  };
}
