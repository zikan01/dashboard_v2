"use client";

import { useEffect, useState } from "react";
import { parseInquiryText } from "@/lib/inquiry-parser";
import { INQUIRY_STATUS_LABEL, type Inquiry } from "@/lib/types";
import { todayStr } from "@/lib/utils";
import { useData } from "@/components/data-provider";
import { Badge, inquiryStatusVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardCaption, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";

export default function InquiriesPage() {
  const {
    ready,
    reservations,
    inquiries,
    addInquiry,
    updateInquiryParsed,
    setInquiryStatus,
    promoteInquiry,
  } = useData();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // 승격 진행 중인 문의 id — 해당 버튼만 로딩 표시
  const [promotingId, setPromotingId] = useState<string | null>(null);
  // 승격 결과 토스트 (성공/실패)
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // 옵션 입력칸은 쉼표 입력 중 상태 유지를 위해 임시 문자열 보관
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});

  // 토스트 자동 닫힘 (5초)
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!ready) return null;

  const saveInquiry = async () => {
    if (!text.trim() || busy) return;
    // 규칙 기반 자동 파싱 — 원문 보존, 결과는 아래에서 직접 수정 가능
    const parsed = parseInquiryText(text.trim(), todayStr());
    setBusy(true);
    await addInquiry(text.trim(), parsed);
    setBusy(false);
    setText("");
    setNotice("");
  };

  // 병합 후보: 이름+연락처+방문일 일치 (TRD §3.7)
  const mergeCandidate = (q: Inquiry) =>
    reservations.find(
      (r) =>
        r.guestName === q.parsed.guestName &&
        r.guestPhone === q.parsed.phone &&
        r.visitStartDate === q.parsed.visitDate
    );

  const promote = async (q: Inquiry) => {
    if (promotingId) return; // 이미 승격 진행 중
    const p = q.parsed;
    const missing: string[] = [];
    if (!p.guestName?.trim()) missing.push("예약자명");
    if (!p.phone?.trim()) missing.push("연락처");
    if (!p.visitDate) missing.push("방문일");
    if (!p.pax || p.pax <= 0) missing.push("인원");
    if (missing.length > 0) {
      setToast({
        type: "error",
        text: `${missing.join("·")}이(가) 비어 있습니다. 입력칸에서 직접 채운 뒤 승격해 주세요.`,
      });
      return;
    }
    setPromotingId(q.id);
    const result = await promoteInquiry(
      {
        guestName: p.guestName!.trim(),
        guestPhone: p.phone!.trim(),
        visitStartDate: p.visitDate!,
        pax: p.pax!,
        options: p.options ?? [],
      },
      q.id
    );
    setPromotingId(null);
    setToast(
      result.ok && result.displayNo
        ? {
            type: "success",
            text: `${result.displayNo} 예약으로 승격되었습니다. 예약 목록·캘린더·대시보드에 반영됩니다.`,
          }
        : {
            type: "error",
            text: result.message ?? "예약 승격에 실패했습니다. 다시 시도해 주세요.",
          }
    );
  };

  const pending = inquiries.filter((q) => q.status === "pending");
  const done = inquiries.filter((q) => q.status !== "pending");

  return (
    <div>
      <div className="mb-[18px] rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
        전화·문자·카톡으로 온 자유 텍스트 예약 문의를 저장하면 방문일·인원·옵션·이름·
        연락처를 <b>자동으로 파싱</b>합니다(규칙 기반, 외부 AI 미사용). 파싱이 안 된
        항목은 직접 입력·수정한 뒤 예약으로 승격하세요.
      </div>

      {notice && (
        <div className="mb-4 rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
          {notice}
        </div>
      )}

      <Card className="mb-5">
        <CardTitle>새 문의 입력</CardTitle>
        <Textarea
          className="mt-2 min-h-[70px]"
          placeholder="예: 다음주 토요일 열명 정도 계곡이랑 바베큐 가능할까요? 김하영 010-3345-2211"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-2.5">
          <Button onClick={saveInquiry}>문의 저장 + 자동 파싱</Button>
        </div>
      </Card>

      <Card>
        <CardTitle>대기 중인 문의</CardTitle>
        <CardCaption>
          자동 파싱된 값은 입력칸에서 직접 수정할 수 있어요. 확인 후 예약으로 승격하면
          표시번호(GMW-…)가 부여됩니다. 원문은 항상 보존됩니다.
        </CardCaption>
        {pending.length === 0 && (
          <div className="py-3 text-[13px] text-muted">대기 중인 문의가 없습니다.</div>
        )}
        {pending.map((q) => {
          const merge = mergeCandidate(q);
          return (
            <div
              key={q.id}
              className="mb-3.5 rounded-[11px] border border-border bg-white p-4 last:mb-0"
            >
              <div className="flex items-center justify-between">
                <b>{q.parsed.guestName || "이름 확인 필요"}</b>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-faint">{q.createdAt}</span>
                  <Badge variant={inquiryStatusVariant[q.status]}>
                    {INQUIRY_STATUS_LABEL[q.status]}
                  </Badge>
                </span>
              </div>
              <div className="mt-1.5 text-[12.5px] text-muted">
                원문: &ldquo;{q.rawText}&rdquo;
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2.5 max-[1080px]:grid-cols-2">
                <div>
                  <div className="mb-1 text-[10.5px] text-muted">방문일</div>
                  <Input
                    type="date"
                    value={q.parsed.visitDate ?? ""}
                    onChange={(e) =>
                      updateInquiryParsed(q.id, {
                        visitDate: e.target.value || undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] text-muted">인원</div>
                  <Input
                    type="number"
                    min={1}
                    placeholder="예: 10"
                    value={q.parsed.pax ?? ""}
                    onChange={(e) =>
                      updateInquiryParsed(q.id, {
                        pax: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] text-muted">
                    옵션 (쉼표로 구분)
                  </div>
                  <Input
                    placeholder="예: 계곡, 바베큐"
                    value={optionDrafts[q.id] ?? q.parsed.options?.join(", ") ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setOptionDrafts((prev) => ({ ...prev, [q.id]: v }));
                      updateInquiryParsed(q.id, {
                        options: v
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                  />
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] text-muted">예약자</div>
                  <Input
                    placeholder="예: 김하영"
                    value={q.parsed.guestName ?? ""}
                    onChange={(e) =>
                      updateInquiryParsed(q.id, {
                        guestName: e.target.value || undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] text-muted">연락처</div>
                  <Input
                    placeholder="예: 010-3345-2211"
                    value={q.parsed.phone ?? ""}
                    onChange={(e) =>
                      updateInquiryParsed(q.id, {
                        phone: e.target.value || undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] text-muted">병합 후보</div>
                  <div className="rounded-btn border border-[#efeae0] bg-cream px-3 py-2 text-[13px] font-semibold">
                    {merge ? `${merge.displayNo} (${merge.guestName})` : "없음"}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex gap-1.5">
                <Button onClick={() => promote(q)} disabled={promotingId !== null}>
                  {promotingId === q.id
                    ? "승격 중…"
                    : merge
                      ? "기존 예약에 병합"
                      : "예약으로 승격"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={promotingId !== null}
                  onClick={() => setInquiryStatus(q.id, "rejected")}
                >
                  반려
                </Button>
              </div>
            </div>
          );
        })}

        {done.length > 0 && (
          <>
            <div className="mb-2 mt-5 text-[12px] font-semibold text-muted">
              처리된 문의
            </div>
            {done.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between border-b border-[#f2eee5] py-2.5 text-[12.5px] last:border-b-0"
              >
                <span className="truncate pr-4 text-muted">{q.rawText}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {q.status === "confirmed" && (
                    <span className="text-[11.5px] text-muted">
                      자체 PK 부여 후 예약 생성
                    </span>
                  )}
                  <Badge variant={inquiryStatusVariant[q.status]}>
                    {INQUIRY_STATUS_LABEL[q.status]}
                  </Badge>
                </span>
              </div>
            ))}
          </>
        )}
      </Card>

      {/* 승격 결과 토스트 — 화면 어디에 있어도 보이도록 고정 표시 */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-50 w-max max-w-[90vw] -translate-x-1/2 rounded-[10px] border px-4 py-3 text-[13px] font-semibold shadow-card ${
            toast.type === "success"
              ? "border-green-100 bg-[#eaf3ec] text-[#2c5c46]"
              : "border-[#eed3d0] bg-[#f9ecea] text-[#a2453c]"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
