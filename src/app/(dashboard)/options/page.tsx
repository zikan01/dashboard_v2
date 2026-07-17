"use client";

// 옵션 업로드 (S-A01, 신규 화면) — 옵션별 준비물 등록·수정·삭제
// FRD 핸드오프 §3.1 요소 E-A01~A10 / §4 검증 / §8 5개 상태
// 신규 화면 디자인 토큰: bg #F4F0E8 · 카드 #FCFAF5(cream) · 딥그린 #1F5C43/#2E7D5B
// 기존 컴포넌트(components/ui/*) 재사용 우선 — 기존 화면 스타일에는 손대지 않는다.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import {
  collectUnmatchedOptions,
  type PreparationGroup,
} from "@/lib/preparation-match";
import { useAuth } from "@/components/auth-provider";
import { useData } from "@/components/data-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardCaption, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ListState = "loading" | "success" | "error";

interface MergePrompt {
  existingId: string;
  existingKeyword: string;
  existingItems: string[];
  newItems: string[];
}

// 쉼표 입력 → 항목 배열 (공백 제거·빈 항목 제거·중복 제거, FRD §4)
function parseItems(raw: string): string[] {
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

function validateForm(keyword: string, itemsRaw: string): string | null {
  const k = keyword.trim();
  if (!k) return "옵션명을 입력해주세요";
  if (k.length > 50) return "옵션명은 50자 이하여야 합니다.";
  const items = parseItems(itemsRaw);
  if (items.length === 0) return "준비물을 1개 이상 입력해주세요";
  if (items.length > 30) return "준비물은 최대 30개까지 등록할 수 있습니다.";
  if (items.some((s) => s.length > 30)) return "준비물 항목은 각 30자 이하여야 합니다.";
  return null;
}

export default function OptionsPage() {
  // useSearchParams는 Suspense 경계 필요 (Next 14)
  return (
    <Suspense fallback={null}>
      <OptionsView />
    </Suspense>
  );
}

function OptionsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { ready, reservations } = useData();

  // 직원 접근 차단 — 대시보드로 리다이렉트 (FRD §2, AC)
  useEffect(() => {
    if (user && user.role !== "owner") router.replace("/");
  }, [user, router]);

  const [listState, setListState] = useState<ListState>("loading");
  const [groups, setGroups] = useState<PreparationGroup[]>([]);
  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  const [itemsRaw, setItemsRaw] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [merge, setMerge] = useState<MergePrompt | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PreparationGroup | null>(null);
  // 인라인 편집 (E-A07)
  const [editId, setEditId] = useState<string | null>(null);
  const [editKeyword, setEditKeyword] = useState("");
  const [editItemsRaw, setEditItemsRaw] = useState("");
  const [editError, setEditError] = useState("");

  const fetchList = useCallback(async () => {
    setListState("loading");
    try {
      const res = await fetch("/api/preparations");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      setGroups(data.preparations ?? []);
      setListState("success");
    } catch {
      setListState("error");
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  // Tier 2: 준비물 미등록 옵션 카드 (E-A10) — 기존 예약의 옵션 중 매칭 실패분
  const unmatched = useMemo(() => {
    if (!ready || listState !== "success") return [];
    return collectUnmatchedOptions(
      reservations.flatMap((r) => r.options),
      groups
    );
  }, [ready, listState, reservations, groups]);

  const submit = async () => {
    if (saving) return;
    const invalid = validateForm(keyword, itemsRaw);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setFormError("");
    setToast("");
    setSaving(true);
    try {
      const res = await fetch("/api/preparations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          option_keyword: keyword.trim(),
          items: parseItems(itemsRaw),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === "duplicate") {
        // 병합 확인 모달 (E-A09)
        setMerge({
          existingId: data.existingId,
          existingKeyword: data.existingKeyword,
          existingItems: data.existingItems ?? [],
          newItems: parseItems(itemsRaw),
        });
        return;
      }
      if (!res.ok) {
        setFormError(data.error ?? "저장에 실패했습니다. 다시 시도해 주세요.");
        return;
      }
      setKeyword("");
      setItemsRaw("");
      setToast(`"${keyword.trim()}" 준비물이 등록되었습니다.`);
      await fetchList();
    } catch {
      setFormError("서버에 연결할 수 없습니다.");
    } finally {
      setSaving(false);
    }
  };

  // 병합 확인: 준비물 = 기존 ∪ 신규 (기존 먼저, 중복 제거 — FRD §4)
  const confirmMerge = async () => {
    if (!merge) return;
    const union = [...merge.existingItems];
    for (const item of merge.newItems) {
      if (!union.includes(item)) union.push(item);
    }
    try {
      const res = await fetch("/api/preparations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: merge.existingId, items: union }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "병합에 실패했습니다.");
        return;
      }
      setKeyword("");
      setItemsRaw("");
      setToast(`"${merge.existingKeyword}"에 준비물을 추가했습니다.`);
      await fetchList();
    } catch {
      setFormError("서버에 연결할 수 없습니다.");
    } finally {
      setMerge(null);
    }
  };

  const startEdit = (g: PreparationGroup) => {
    setEditId(g.id);
    setEditKeyword(g.option_keyword);
    setEditItemsRaw(g.items.join(", "));
    setEditError("");
  };

  const saveEdit = async () => {
    if (!editId) return;
    const invalid = validateForm(editKeyword, editItemsRaw);
    if (invalid) {
      setEditError(invalid);
      return;
    }
    try {
      const res = await fetch("/api/preparations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editId,
          option_keyword: editKeyword.trim(),
          items: parseItems(editItemsRaw),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === "duplicate") {
        setEditError(`"${data.existingKeyword}"이(가) 이미 있습니다. 병합하려면 삭제 후 등록 폼에서 같은 옵션명으로 등록해주세요.`);
        return;
      }
      if (!res.ok) {
        setEditError(data.error ?? "수정에 실패했습니다.");
        return;
      }
      setEditId(null);
      setToast("수정되었습니다.");
      await fetchList();
    } catch {
      setEditError("서버에 연결할 수 없습니다.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch("/api/preparations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      setToast(`"${deleteTarget.option_keyword}"을(를) 삭제했습니다. 해당 옵션 예약에는 "준비물 미등록"으로 표시됩니다.`);
      await fetchList();
    } catch {
      setToast("서버에 연결할 수 없습니다.");
    } finally {
      setDeleteTarget(null);
    }
  };

  if (user && user.role !== "owner") return null; // 리다이렉트 중

  return (
    <div>
      {/* E-A02 화면 설명 */}
      <div className="mb-[18px] rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
        옵션별 준비물을 등록하면 예약 상세와 내보내기에 자동 표시됩니다. 옵션명은 예약
        옵션 텍스트와 부분 일치(공백·대소문자 무시)로 연결됩니다.
      </div>

      {toast && (
        <div className="mb-4 rounded-[10px] border border-green-100 bg-[#eaf3ec] px-3.5 py-[11px] text-[12.5px] text-[#2c5c46]">
          {toast}
        </div>
      )}

      {/* 등록 폼 (E-A03~05) */}
      <Card className="mb-5 bg-cream">
        <CardTitle>준비물 등록</CardTitle>
        <CardCaption>
          예: 옵션명 &quot;바베큐&quot; — 옵션 &quot;바베큐 4인 세트&quot;에도 자동으로
          연결됩니다.
        </CardCaption>
        <div className="flex flex-wrap items-start gap-2.5">
          <div className="w-[180px] max-[560px]:w-full">
            <div className="mb-1 text-[11.5px] text-muted">옵션명</div>
            <Input
              placeholder="바베큐"
              value={keyword}
              maxLength={50}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="min-w-[240px] flex-1 max-[560px]:w-full">
            <div className="mb-1 text-[11.5px] text-muted">준비물</div>
            <Input
              placeholder="고기, 숯, 집게, 장갑 (쉼표로 구분)"
              value={itemsRaw}
              onChange={(e) => setItemsRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
          <div className="pt-[21px] max-[560px]:w-full max-[560px]:pt-0">
            <Button onClick={submit} disabled={saving} className="max-[560px]:w-full">
              <Plus size={14} />
              {saving ? "저장 중…" : "등록"}
            </Button>
          </div>
        </div>
        {formError && (
          <div className="mt-2.5 text-[12px] text-[#a2453c]">{formError}</div>
        )}
      </Card>

      {/* Tier 2: 미등록 옵션 카드 (E-A10) */}
      {unmatched.length > 0 && (
        <Card className="mb-5 border-amber-100 bg-[#fdf8ee]">
          <CardTitle className="text-amber-700">
            준비물 미등록 옵션 {unmatched.length}개
          </CardTitle>
          <CardCaption>
            예약에 있는 옵션인데 준비물이 없어요. 옵션명을 누르면 위 입력칸에
            채워집니다.
          </CardCaption>
          <div className="flex flex-wrap gap-1.5">
            {unmatched.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  setKeyword(o);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-full border border-amber-100 bg-white px-2.5 py-[3px] text-[12px] text-amber-700 hover:bg-[#f9f3e6]"
              >
                {o}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* 등록 목록 (E-A06) — 5개 상태: Loading / Error / Empty / Success */}
      <Card>
        <CardTitle>등록된 옵션</CardTitle>
        <CardCaption>
          준비물을 수정하면 과거 예약 상세에도 즉시 반영됩니다 (조회 시 계산).
        </CardCaption>

        {listState === "loading" && (
          <div className="space-y-2.5 py-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[38px] animate-pulse rounded-[9px] bg-sand-100" />
            ))}
          </div>
        )}

        {listState === "error" && (
          <div className="py-3 text-center">
            <div className="mb-2.5 text-[12.5px] text-muted">
              목록을 불러오지 못했습니다
            </div>
            <Button variant="ghost" onClick={fetchList}>
              다시 시도
            </Button>
          </div>
        )}

        {listState === "success" && groups.length === 0 && (
          <div className="py-4 text-center text-[12.5px] text-muted">
            등록된 옵션이 없습니다. 위에서 옵션명과 준비물을 입력해 시작해 보세요.
          </div>
        )}

        {listState === "success" && groups.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["옵션명", "준비물", ""].map((h, i) => (
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
              {groups.map((g) =>
                editId === g.id ? (
                  <tr key={g.id}>
                    <td className="border-b border-[#f2eee5] px-2.5 py-2.5 align-top">
                      <Input
                        value={editKeyword}
                        maxLength={50}
                        onChange={(e) => setEditKeyword(e.target.value)}
                      />
                    </td>
                    <td className="border-b border-[#f2eee5] px-2.5 py-2.5">
                      <Input
                        value={editItemsRaw}
                        onChange={(e) => setEditItemsRaw(e.target.value)}
                      />
                      {editError && (
                        <div className="mt-1.5 text-[11.5px] text-[#a2453c]">
                          {editError}
                        </div>
                      )}
                    </td>
                    <td className="w-[90px] border-b border-[#f2eee5] px-2.5 py-2.5 align-top">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          title="저장"
                          onClick={saveEdit}
                          className="flex h-8 w-8 items-center justify-center rounded-btn bg-green-700 text-white hover:bg-green-800"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          title="취소"
                          onClick={() => setEditId(null)}
                          className="flex h-8 w-8 items-center justify-center rounded-btn border border-border bg-white text-muted hover:bg-[#f5f2ea]"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={g.id}>
                    <td className="border-b border-[#f2eee5] px-2.5 py-[13px] text-[13px] font-semibold text-green-700">
                      {g.option_keyword}
                    </td>
                    <td className="border-b border-[#f2eee5] px-2.5 py-[11px]">
                      <div className="flex flex-wrap gap-1.5">
                        {g.items.map((item) => (
                          <span
                            key={item}
                            className="rounded-full bg-sand-100 px-2.5 py-[3px] text-[11.5px] text-[#55514a]"
                          >
                            {item}
                          </span>
                        ))}
                        {!g.is_active && <Badge variant="gray">비활성</Badge>}
                      </div>
                    </td>
                    <td className="w-[90px] border-b border-[#f2eee5] px-2.5 py-[11px]">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          title="수정"
                          onClick={() => startEdit(g)}
                          className="flex h-8 w-8 items-center justify-center rounded-btn border border-border bg-white text-muted hover:bg-[#f5f2ea] hover:text-ink"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          title="삭제"
                          onClick={() => setDeleteTarget(g)}
                          className="flex h-8 w-8 items-center justify-center rounded-btn border border-border bg-white text-[#a2453c] hover:bg-[#f9ecea]"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* 병합 확인 모달 (E-A09) */}
      {merge && (
        <Modal>
          <div className="text-[15px] font-bold">이미 등록된 옵션입니다</div>
          <div className="mt-1.5 text-[12.5px] text-muted">
            &quot;{merge.existingKeyword}&quot;의 준비물에 추가할까요? 기존 준비물은
            유지되고 새 항목만 더해집니다.
          </div>
          <div className="mt-3 rounded-[10px] bg-[#faf7f0] px-3.5 py-2.5 text-[12.5px]">
            <div>
              <b>기존</b> · {merge.existingItems.join(", ") || "—"}
            </div>
            <div className="mt-1">
              <b>추가</b> · {merge.newItems.join(", ")}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMerge(null)}>
              취소
            </Button>
            <Button onClick={confirmMerge}>준비물에 추가</Button>
          </div>
        </Modal>
      )}

      {/* 삭제 확인 모달 (E-A08) */}
      {deleteTarget && (
        <Modal>
          <div className="text-[15px] font-bold">
            &quot;{deleteTarget.option_keyword}&quot;을(를) 삭제할까요?
          </div>
          <div className="mt-1.5 text-[12.5px] text-muted">
            이 옵션이 있는 예약 상세에는 &quot;준비물 미등록&quot;으로 표시됩니다.
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              취소
            </Button>
            <button
              type="button"
              onClick={confirmDelete}
              className="rounded-btn bg-[#c0392b] px-4 py-[9px] text-[13px] font-semibold text-white hover:bg-[#a93226]"
            >
              삭제
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-[420px] rounded-card border border-border bg-cream p-5 shadow-card">
        {children}
      </div>
    </div>
  );
}
