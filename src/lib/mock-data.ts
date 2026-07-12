// 화면 표시용 정적 데이터.
// 예약·업로드이력·수정이력은 이제 localStorage 기반 DataProvider(src/components/data-provider.tsx)가 관리하며,
// TODO: 2단계에서 Supabase 조회로 교체한다.

// 옵션별 준비물 예시 (FRD §8 — 수량 계산은 v1 제외)
export const PREPARATION_ITEMS: Record<string, string> = {
  바베큐: "고기, 숯, 집게, 장갑, 채소, 일회용 식기",
  계곡: "물놀이 안내, 안전용품, 수건, 구급용품",
  버스왕복: "차량 배차 확인, 탑승 인원 확인, 기사 연락",
  매실: "매실, 설탕, 용기, 장갑",
  숙박: "침구, 객실 정리, 수건, 비품",
};

// 준비 알림 D-day 기준 문구 (FRD §7)
export const PREP_ALERT_RULES: Record<number, string> = {
  0: "오늘 방문 예약",
  1: "최종 인원·옵션 확인",
  3: "고객 안내 필요",
  5: "준비물 확인",
  7: "예약 내용 확인",
};

// 내보내기 화면 컬럼 정의 (export_profiles.columns 대응)
export const EXPORT_COLUMNS = [
  { key: "displayNo", label: "표시번호" },
  { key: "visitStartDate", label: "방문일" },
  { key: "guestName", label: "예약자" },
  { key: "guestPhone", label: "연락처" },
  { key: "pax", label: "인원" },
  { key: "options", label: "옵션" },
  { key: "paidAmount", label: "결제금액" },
  { key: "reservationStatus", label: "예약상태" },
  { key: "settlementStatus", label: "정산상태" },
  { key: "taxInvoiceStatus", label: "세금계산서" },
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];
