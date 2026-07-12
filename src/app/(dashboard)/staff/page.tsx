"use client";

// 직원 관리 (🔑 대표 전용) — Supabase Auth 초대 메일 + profiles 역할/상태 관리

import { useState } from "react";
import { useData } from "@/components/data-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function StaffPage() {
  const { ready, staff, inviteStaff, setStaffStatus } = useData();
  const [showInvite, setShowInvite] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  if (!ready) return null;

  const invite = async () => {
    if (!name.trim() || !email.trim() || busy) return;
    setBusy(true);
    const result = await inviteStaff(email.trim(), name.trim());
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message ?? "초대에 실패했습니다.");
      return;
    }
    setNotice(
      `${email.trim()} 주소로 초대 메일을 보냈습니다. 직원이 메일의 링크에서 비밀번호를 설정하면 바로 로그인할 수 있습니다.`
    );
    setName("");
    setEmail("");
    setShowInvite(false);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[12.5px] text-muted">
          대표(관리자)만 직원 계정을 초대하거나 비활성화할 수 있어요. 비활성화된
          직원은 로그인과 데이터 접근이 모두 차단됩니다.
        </div>
        <Button onClick={() => setShowInvite((v) => !v)}>+ 직원 초대</Button>
      </div>

      {notice && (
        <div className="mb-4 rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
          {notice}
        </div>
      )}

      {showInvite && (
        <Card className="mb-4">
          <CardTitle>직원 초대</CardTitle>
          <div className="mt-3 flex flex-wrap items-end gap-2.5">
            <div className="w-[180px]">
              <label className="mb-1 block text-[11.5px] text-muted">이름</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
            </div>
            <div className="w-[260px]">
              <label className="mb-1 block text-[11.5px] text-muted">이메일</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@example.com"
              />
            </div>
            <Button onClick={invite} disabled={busy}>
              {busy ? "발송 중…" : "초대 메일 보내기"}
            </Button>
          </div>
        </Card>
      )}

      <div className="rounded-card border border-border bg-white px-3.5 py-1.5 shadow-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["이름", "이메일", "역할", "상태", ""].map((h, i) => (
                <th
                  key={i}
                  className="border-b border-border bg-[#faf7f0] px-2.5 py-3 text-left text-[11.5px] font-semibold text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] font-bold">
                  {s.name}
                </td>
                <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-xs tabular-nums text-[#6f6a5f]">
                  {s.email}
                </td>
                <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                  <span
                    className={cn(
                      "rounded-full px-2 py-[2px] text-[10px] font-semibold",
                      s.role === "owner"
                        ? "bg-green-100 text-green-700"
                        : "bg-[#eceae3] text-[#7d786c]"
                    )}
                  >
                    {s.role === "owner" ? "대표" : "직원"}
                  </span>
                </td>
                <td className="border-b border-[#f2eee5] px-2.5 py-[13px]">
                  {s.status === "active" ? (
                    <Badge variant="green">활성</Badge>
                  ) : (
                    <Badge variant="gray">비활성</Badge>
                  )}
                </td>
                <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-right">
                  {s.role !== "owner" && (
                    <button
                      onClick={() =>
                        setStaffStatus(
                          s.id,
                          s.status === "active" ? "inactive" : "active"
                        )
                      }
                      className="rounded-btn border border-border bg-white px-3 py-[7px] text-[12.5px] text-[#55514a] hover:bg-[#f5f2ea]"
                    >
                      {s.status === "active" ? "비활성화" : "다시 활성화"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2.5 py-8 text-center text-[13px] text-muted">
                  등록된 계정이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
