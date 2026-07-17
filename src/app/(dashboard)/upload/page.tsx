"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, Upload } from "lucide-react";
import {
  buildImportPlan,
  parseExcelFile,
  validateExcelFile,
  type ImportPlan,
} from "@/lib/excel";
import { PREVIEW_ACTION_LABEL } from "@/lib/types";
import { useData } from "@/components/data-provider";
import { Badge, previewActionVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardCaption, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Phase = "idle" | "preview" | "applied";

// MS 복합 파일(CFB) 시그니처 — 비밀번호 걸린 엑셀(OOXML)은 이 컨테이너에 담긴다
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

async function isCfbFile(f: File): Promise<boolean> {
  const head = new Uint8Array(await f.slice(0, 8).arrayBuffer());
  return (
    head.length === 8 && CFB_SIGNATURE.every((b, i) => head[i] === b)
  );
}

interface SettingsStatus {
  passwordSet: boolean;
  tokenIssuedAt: string | null;
}

export default function UploadPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const settingsCardRef = useRef<HTMLDivElement>(null);
  const { ready, reservations, canRevert, applyImport, revertLastImport } =
    useData();

  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [parseError, setParseError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- 네이버 파일 비밀번호 설정 카드 (FRD E-A11~14) ----
  const [settings, setSettings] = useState<SettingsStatus | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [issuedToken, setIssuedToken] = useState(""); // 원문은 발급 직후 1회만 표시

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setSettingsError(data.error ?? "설정을 불러오지 못했습니다.");
          return;
        }
        setSettings(data);
      })
      .catch(() => {
        if (!cancelled) setSettingsError("설정을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const savePassword = async () => {
    const pw = pwInput.trim();
    if (!pw) {
      setPwMsg("비밀번호를 입력해주세요");
      return;
    }
    if (pwBusy) return;
    setPwBusy(true);
    setPwMsg("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwMsg(data.error ?? "저장에 실패했습니다. 다시 시도해 주세요.");
        return;
      }
      setPwInput(""); // 저장 후 빈 값 표시 (평문 잔류 금지)
      setSettings((prev) => ({
        passwordSet: true,
        tokenIssuedAt: prev?.tokenIssuedAt ?? null,
      }));
      setPwMsg("비밀번호가 등록되었습니다. 암호화된 엑셀도 그대로 업로드할 수 있어요.");
    } finally {
      setPwBusy(false);
    }
  };

  const issueToken = async () => {
    if (tokenBusy) return;
    if (
      settings?.tokenIssuedAt &&
      !window.confirm(
        "토큰을 다시 발급하면 기존 토큰은 즉시 사용할 수 없게 됩니다. 계속할까요?"
      )
    ) {
      return;
    }
    setTokenBusy(true);
    setPwMsg("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueToken: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwMsg(data.error ?? "토큰 발급에 실패했습니다.");
        return;
      }
      setIssuedToken(data.token);
      setSettings((prev) => ({
        passwordSet: prev?.passwordSet ?? false,
        tokenIssuedAt: data.tokenIssuedAt,
      }));
    } finally {
      setTokenBusy(false);
    }
  };

  // 암호화 파일: 서버에서 복호화·파싱해 계획을 받아온다 (브라우저는 복호화 불가)
  const serverPreview = async (f: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("mode", "preview");
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParseError(data.error ?? "파일을 읽지 못했습니다.");
        if (data.code === "password_not_set") {
          settingsCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      setPlan(data.plan);
      setPhase("preview");
    } catch {
      setParseError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!f) return;
    setParseError("");
    setNotice("");
    // 크기(10MB)·확장자·MIME 사전 검증
    const invalid = validateExcelFile(f);
    if (invalid) {
      setParseError(invalid);
      return;
    }
    // 암호화(CFB) 파일이면 서버 경로로 — 비암호화 파일은 기존과 완전 동일 동작
    if (await isCfbFile(f)) {
      await serverPreview(f);
      return;
    }
    try {
      const parsed = await parseExcelFile(f);
      if (parsed.rows.length === 0 && parsed.errors.length === 0) {
        setParseError("파일에서 예약 데이터를 찾지 못했습니다.");
        return;
      }
      setPlan(buildImportPlan(reservations, parsed, f.name));
      setPhase("preview");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "파일을 읽지 못했습니다.");
    }
  };

  const apply = async () => {
    if (!plan || busy) return;
    setBusy(true);
    setParseError("");
    const result = await applyImport(plan);
    setBusy(false);
    if (!result.ok) {
      setParseError(result.message ?? "반영에 실패했습니다. 다시 시도해 주세요.");
      return;
    }
    setPhase("applied");
  };

  const revert = async () => {
    if (busy) return;
    setBusy(true);
    const result = await revertLastImport();
    setBusy(false);
    setPlan(null);
    setPhase("idle");
    setNotice(
      result.ok
        ? "마지막 반영을 되돌렸습니다. (마지막 1건만 지원)"
        : result.message ?? "되돌리기에 실패했습니다."
    );
  };

  if (!ready) return null;
  const c = plan?.counts;

  return (
    <div>
      {phase === "applied" && c && (
        <div className="mb-4 rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
          반영 완료 · 신규 {c.create} · 업데이트 {c.update} · 병합 {c.merge} · 취소{" "}
          {c.cancel}
          {c.error > 0 && ` · 오류 ${c.error}건 제외`} — 대시보드·예약 목록·캘린더에
          바로 반영되었습니다. (로컬 엑셀 동시 저장은 2단계에서 연동)
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-[10px] border border-amber-100 bg-[#f9f3e6] px-3.5 py-[11px] text-[12.5px] text-amber-700">
          {notice}
        </div>
      )}
      {parseError && (
        <div className="mb-4 rounded-[10px] border border-[#eed3d0] bg-[#f9ecea] px-3.5 py-[11px] text-[12.5px] text-[#a2453c]">
          {parseError}
        </div>
      )}

      <div className="mb-[22px] rounded-card border-2 border-dashed border-[#d8d2c4] bg-cream p-11 text-center">
        <div className="mx-auto mb-3 flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-green-100 text-green-700">
          <Upload size={22} />
        </div>
        <div className="text-[15px] font-semibold">
          네이버 예약 상세 엑셀 파일을 올려주세요
        </div>
        <div className="mb-4 mt-1.5 text-[12.5px] text-muted">
          파일을 선택하면 검증 후 미리보기가 표시되고, 반영하기를 눌러야 저장됩니다 ·
          .xlsx, .xls
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={onFileChange}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy && phase === "idle" ? "파일 확인 중…" : "파일 선택"}
        </Button>
        <Button variant="ghost" className="ml-2" disabled title="2단계에서 연동 예정">
          로컬 수집기로 가져오기 (예정)
        </Button>
        {canRevert && (
          <div className="mt-4">
            <Button variant="ghost" onClick={revert}>
              마지막 업로드 되돌리기
            </Button>
          </div>
        )}
      </div>

      {/* 네이버 파일 비밀번호 · 수집기 토큰 설정 (관리자 전용 화면 — FRD S-A02) */}
      <div ref={settingsCardRef}>
        <Card className="mb-[22px]">
          <CardTitle>
            <KeyRound size={15} className="text-green-700" />
            네이버 파일 비밀번호
            {settings && (
              <Badge variant={settings.passwordSet ? "green" : "gray"}>
                {settings.passwordSet ? "등록됨" : "미등록"}
              </Badge>
            )}
          </CardTitle>
          <CardCaption>
            네이버에서 내려받은 엑셀의 열기 비밀번호를 한 번만 등록하면, 웹 업로드와
            수집기 양쪽에서 자동으로 풀어서 처리합니다. 비밀번호는 암호화되어 저장되며
            화면·응답에 다시 표시되지 않습니다.
          </CardCaption>
          {settingsError && (
            <div className="mb-3 rounded-[10px] border border-[#eed3d0] bg-[#f9ecea] px-3.5 py-[11px] text-[12.5px] text-[#a2453c]">
              {settingsError}
            </div>
          )}
          <div className="flex max-w-[420px] items-center gap-2">
            <Input
              type="password"
              autoComplete="new-password"
              placeholder={settings?.passwordSet ? "새 비밀번호로 변경하려면 입력" : "파일 비밀번호 입력"}
              value={pwInput}
              maxLength={64}
              onChange={(e) => setPwInput(e.target.value)}
            />
            <Button onClick={savePassword} disabled={pwBusy}>
              {pwBusy ? "저장 중…" : "저장"}
            </Button>
          </div>

          <div className="mt-5 border-t border-[#f0ece2] pt-4">
            <div className="text-[13px] font-semibold">수집기 연결 토큰</div>
            <div className="mb-2.5 mt-1 text-[11.5px] text-muted">
              대표 PC의 수집기(config.json)에 넣을 전용 토큰입니다. 발급 시 1회만
              표시되니 바로 복사해 주세요.
              {settings?.tokenIssuedAt &&
                ` · 마지막 발급: ${settings.tokenIssuedAt.slice(0, 10)}`}
            </div>
            <Button variant="ghost" onClick={issueToken} disabled={tokenBusy}>
              {tokenBusy
                ? "발급 중…"
                : settings?.tokenIssuedAt
                  ? "토큰 재발급 (기존 토큰 무효화)"
                  : "수집기 토큰 발급"}
            </Button>
            {issuedToken && (
              <div className="mt-2.5 rounded-[10px] border border-amber-100 bg-[#f9f3e6] px-3.5 py-[11px] text-[12.5px] text-amber-700">
                <b>지금 복사하세요 — 다시 볼 수 없습니다.</b>
                <div className="mt-1 break-all font-mono text-[12px] text-ink">
                  {issuedToken}
                </div>
              </div>
            )}
          </div>
          {pwMsg && (
            <div className="mt-3 text-[12px] text-green-700">{pwMsg}</div>
          )}
        </Card>
      </div>

      {plan && phase !== "idle" && (
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <CardTitle>업로드 미리보기</CardTitle>
            <Button onClick={apply} disabled={phase === "applied" || busy}>
              {phase === "applied" ? "반영 완료" : busy ? "반영 중…" : "반영하기"}
            </Button>
          </div>
          <CardCaption>{plan.fileName} · 반영 전 검토</CardCaption>

          <div className="mb-4 grid grid-cols-6 gap-3 max-[1080px]:grid-cols-3">
            {[
              { label: "전체 예약", value: plan.counts.total },
              { label: "신규", value: plan.counts.create },
              { label: "업데이트", value: plan.counts.update },
              { label: "병합 후보", value: plan.counts.merge, highlight: true },
              { label: "취소", value: plan.counts.cancel },
              { label: "오류", value: plan.counts.error },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-[11px] border border-border bg-white p-3.5 text-center"
              >
                <div
                  className={`mb-1 text-[11px] ${card.highlight ? "font-semibold text-green-700" : "text-muted"}`}
                >
                  {card.label}
                </div>
                <div className="text-2xl font-bold">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["표시번호", "예약자", "처리", "내용"].map((h) => (
                    <th
                      key={h}
                      className="border-b border-border bg-[#faf7f0] px-2.5 py-3 text-left text-[11.5px] font-semibold text-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.items.map((item, i) => (
                  <tr key={`${item.displayNo}-${i}`}>
                    <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-xs tabular-nums text-[#6f6a5f]">
                      {item.displayNo}
                    </td>
                    <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] font-bold">
                      {item.guestName}
                    </td>
                    <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                      <Badge variant={previewActionVariant[item.action]}>
                        {PREVIEW_ACTION_LABEL[item.action]}
                      </Badge>
                    </td>
                    <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px]">
                      {item.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plan.errors.length > 0 && (
            <div className="mt-4 rounded-[10px] border border-[#eed3d0] bg-[#f9ecea] px-3.5 py-[11px] text-[12.5px] text-[#a2453c]">
              <b>오류 {plan.errors.length}건 (반영에서 제외됩니다)</b>
              <ul className="mt-1.5 space-y-0.5">
                {plan.errors.map((err) => (
                  <li key={err.row}>
                    {err.row}행 · {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 text-[11.5px] text-muted">
            * 같은 예약(네이버 예약번호 또는 이름+연락처+방문일 일치)은 새로 만들지 않고
            업데이트/병합되며, 정산·세금계산서·메모는 덮어쓰지 않습니다. 반영 후 마지막
            1건은 되돌릴 수 있습니다.
          </div>
        </Card>
      )}
    </div>
  );
}
