import { describe, expect, it } from "vitest";
import { decideDispatch, revalidateJob } from "./dispatch-policy";
import type { JobRow, ReservationSnapshot } from "./types";

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: "j1", business_id: "b1", reservation_id: "r1", rule_id: "ru1",
  stage: "d_1", base_visit_date: "2026-08-20", scheduled_at: "2026-08-19T06:00:00Z",
  status: "processing", attempt_count: 1, ...over,
});
const res = (over: Partial<ReservationSnapshot> = {}): ReservationSnapshot => ({
  id: "r1", guest_name: "김민지", guest_phone: "010-1234-5678",
  visit_start_date: "2026-08-20", reservation_status: "confirmed", ...over,
});

describe("revalidateJob (발송 직전 재검증, TRD §15)", () => {
  it("정상 예약은 통과", () => {
    expect(revalidateJob(job(), res(), true, false)).toBeNull();
  });
  it("취소 예약", () => {
    expect(revalidateJob(job(), res({ reservation_status: "cancelled" }), true, false))
      .toBe("reservation_cancelled");
  });
  it("방문일이 바뀐 작업", () => {
    expect(revalidateJob(job(), res({ visit_start_date: "2026-08-25" }), true, false))
      .toBe("visit_date_changed");
  });
  it("자동 안내 비활성", () => {
    expect(revalidateJob(job(), res(), false, false)).toBe("notification_disabled");
  });
  it("마스킹 전화번호", () => {
    expect(revalidateJob(job(), res({ guest_phone: "******4158" }), true, false))
      .toBe("invalid_phone");
  });
  it("동일 단계 이미 성공", () => {
    expect(revalidateJob(job(), res(), true, true)).toBe("already_succeeded");
  });
});

describe("decideDispatch (발송 모드 게이트, TRD §22)", () => {
  it("dry_run이면 외부 발송 없이 기록만", () => {
    expect(decideDispatch("dry_run", "01012345678", [])).toEqual({ action: "dry_run" });
  });
  it("allowlist 모드: 목록에 있으면 발송", () => {
    expect(decideDispatch("allowlist", "01012345678", ["01012345678"]))
      .toEqual({ action: "send" });
  });
  it("allowlist 모드: 목록에 없으면 차단", () => {
    expect(decideDispatch("allowlist", "01099998888", ["01012345678"]))
      .toEqual({ action: "blocked_by_allowlist" });
  });
  it("live면 발송", () => {
    expect(decideDispatch("live", "01012345678", [])).toEqual({ action: "send" });
  });
  it("알 수 없는 모드 값은 dry_run으로 처리한다 (fail-safe)", () => {
    expect(decideDispatch("Live" as never, "01012345678", [])).toEqual({ action: "dry_run" });
    expect(decideDispatch("" as never, "01012345678", [])).toEqual({ action: "dry_run" });
  });
});
