"use client";

// SOLAPI 설정 (🔑 대표 전용) — 연결 상태·잔액·발송 모드 확인 + 테스트 발송 (FRD §7)

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtKst } from "@/lib/notifications/ui-labels";
import { cn } from "@/lib/utils";

interface Status {
  keyRegistered: boolean;
  connected: boolean;
  balance: number | null;
  senderNumber: string | null;
  mode: string;
  checkedAt: string;
}

const MODE_LABEL: Record<string, string> = {
  dry_run: "드라이런(실발송 없음)",
  allowlist: "테스트 번호만",
  live: "운영 발송",
};

const MODE_VARIANT: Record<string, BadgeProps["variant"]> = {
  dry_run: "gray",
  allowlist: "amber",
  live: "green",
};

export default function SolapiSettingsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [to, setTo] = useState("");
  const [notice, setNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    const res = await fetch("/api/settings/solapi");
    const body = await res.json();
    setChecking(false);
    if (!res.ok) { setErrorMsg(body.error ?? "상태를 불러오지 못했습니다."); return; }
    setStatus(body);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setNotice(""); setErrorMsg("");
    await load();
  };

  const sendTest = async () => {
    if (!to.trim()) { setErrorMsg("수신 번호를 입력하세요."); return; }
    setSending(true); setNotice(""); setErrorMsg("");
    const res = await fetch("/api/settings/solapi/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    const body = await res.json();
    setSending(false);
    if (!res.ok) { setErrorMsg(body.error ?? "테스트 발송에 실패했습니다."); return; }
    setNotice(`발송 성공 · ${body.messageType} · 약 ${body.cost}원`);
  };

  if (user?.role !== "owner") {
    return <div className="text-[13px] text-muted">대표(관리자)만 접근할 수 있는 메뉴입니다.</div>;
  }
  if (!status) return <div className="text-[13px] text-muted">불러오는 중…</div>;

  const lowBalance = status.balance !== null && status.balance < 1000;

  return (
    <div className="flex flex-col gap-4">
      {notice && <div className="rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">{notice}</div>}
      {errorMsg && <div className="rounded-[10px] border border-red-100 bg-red-50 px-3.5 py-[11px] text-[12.5px] text-red-700">{errorMsg}</div>}

      <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
        <Card>
          <div className="text-[11.5px] text-muted">연결 상태</div>
          <div className={cn("mt-1.5 text-[15px] font-bold", status.connected ? "text-green-700" : "text-red-700")}>
            {status.connected ? "연결됨" : "연결 실패"}
          </div>
        </Card>
        <Card>
          <div className="text-[11.5px] text-muted">API Key</div>
          <div className="mt-1.5 text-[15px] font-bold">{status.keyRegistered ? "등록됨" : "미등록"}</div>
          <div className="mt-1 text-[11px] text-faint">Secret 원문 미표시</div>
        </Card>
        <Card>
          <div className="text-[11.5px] text-muted">발신번호</div>
          <div className="mt-1.5 text-[15px] font-bold tabular-nums">{status.senderNumber ?? "—"}</div>
        </Card>
        <Card>
          <div className="text-[11.5px] text-muted">잔액</div>
          <div className={cn("mt-1.5 text-[15px] font-bold", lowBalance && "text-red-700")}>
            {status.balance !== null ? `${status.balance.toLocaleString("ko-KR")}원` : "—"}
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="text-muted">발송 모드</span>
        <Badge variant={MODE_VARIANT[status.mode] ?? "gray"}>{MODE_LABEL[status.mode] ?? status.mode}</Badge>
      </div>

      {lowBalance && (
        <div className="rounded-[10px] border border-red-100 bg-red-50 px-3.5 py-[11px] text-[12.5px] text-red-700">
          잔액이 부족합니다. 자동 발송이 중단될 수 있어 충전이 필요합니다.
        </div>
      )}

      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>최근 확인 · {fmtKst(status.checkedAt)}</span>
        <button
          type="button"
          onClick={refresh}
          disabled={checking}
          className="rounded-btn border border-border bg-white px-3 py-[7px] text-[12.5px] text-[#55514a] hover:bg-[#f5f2ea] disabled:pointer-events-none disabled:opacity-50"
        >
          {checking ? "확인 중…" : "다시 확인"}
        </button>
      </div>

      <Card>
        <CardTitle>테스트 발송</CardTitle>
        <div className="mt-3 flex items-end gap-2.5">
          <div className="flex-1">
            <label className="mb-1 block text-[11.5px] text-muted">수신 번호</label>
            <Input value={to} placeholder="등록된 테스트 번호" onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={sendTest} disabled={sending}>{sending ? "발송 중…" : "테스트 문자 보내기"}</Button>
        </div>
      </Card>
    </div>
  );
}
