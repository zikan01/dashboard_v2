// SOLAPI Provider (TRD §16) — solapi SDK 5.5.1
// 응답 구조는 2026-07-17 실발송으로 확인: messageList는 배열이 아니라
// messageId를 키로 하는 객체이며, 선불 충전액은 balance가 아닌 point에 담긴다.
import { SolapiMessageService } from "solapi";
import type { MessageProvider, ProviderSendResult } from "./message-provider";

const firstMessage = (res: any): any =>
  Object.values(res?.messageList ?? {})[0] ?? undefined;

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
        const groupId = res?.groupInfo?.groupId ?? res?.groupId;
        let first = firstMessage(res);
        if (!first?.messageId && groupId) {
          // 발송 응답에 개별 메시지가 없으면 그룹 조회로 보완 (읽기 호출, 무료)
          try {
            first = firstMessage(await svc.getMessages({ groupId }));
          } catch {
            // 조회 실패는 발송 성공 여부에 영향 없음 — 상태 대조 Cron이 재시도
          }
        }
        return {
          ok: true,
          providerGroupId: groupId,
          providerMessageId: first?.messageId,
          messageType: first?.type,
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
        const msg = firstMessage(res);
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
      // 콘솔 "합산 잔액"과 동일한 계산 (2026-07-17 실계정 대조: deposit 10,000 / balance 9,000 / point 300 → 콘솔 10,300)
      // 국내 결제는 deposit(예치금), 해외 결제는 balance(잔액)에 담기고, 국내 충전 계정의
      // balance는 예치금에서 부가세를 뺀 파생값이라 둘을 더하면 이중 계산 — 큰 쪽 + point로 합산
      const res: any = await svc.getBalance();
      return (
        Math.max(Number(res?.balance ?? 0), Number(res?.deposit ?? 0)) +
        Number(res?.point ?? 0)
      );
    },
  };
}
