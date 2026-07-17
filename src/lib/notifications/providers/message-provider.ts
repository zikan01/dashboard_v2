// 메시지 Provider 인터페이스 (TRD §16.1) — 향후 알림톡 채널 추가 시 확장 지점

export interface ProviderSendResult {
  ok: boolean;
  providerMessageId?: string;
  providerGroupId?: string;
  messageType?: string; // Provider가 판별한 최종 SMS/LMS
  errorCode?: string;
  errorMessage?: string;
}

export interface ProviderStatusResult {
  status: "pending" | "delivered" | "failed" | "unknown";
  errorCode?: string;
}

export interface MessageProvider {
  sendSms(input: { to: string; from: string; text: string }): Promise<ProviderSendResult>;
  getMessageStatus(providerMessageId: string): Promise<ProviderStatusResult>;
  getBalance(): Promise<number>;
}
