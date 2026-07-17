// 고마워할매 로컬 수집기 — 6단계 파이프라인 (TRD 핸드오프 §6)
//
//   1. config 로드 → 2. CDP 접속(실패 시 전용 프로필로 브라우저 실행) →
//   3. 예약자관리 이동 → 로그인 감지 → 4. "상세 내려받기" 클릭 →
//   5. 다운로드 폴더 감시 → 6. (필요 시 복호화 후) /api/import 업로드(auto_apply)
//
// 보안 원칙 (TRD §8):
//   - 네이버 자격증명을 저장·입력하지 않는다. 로그인은 대표가 브라우저에서 직접.
//   - 디버그 포트는 127.0.0.1 전용, 수집 전용 프로필로 상시 브라우저와 격리.
//   - 로그에 개인정보 금지 — 단계·건수·사유만.
//
// 종료 코드: 0 성공 / 1 일반 실패 / 2 로그인 필요 / 3 버튼 못 찾음 /
//            4 다운로드 시간 초과 / 5 복호화 실패 / 6 업로드 실패

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser, type Page } from "playwright-core";
import { baseDir, expandEnv, loadConfig, type CollectorConfig } from "./config";
import { decryptExcel, isEncryptedExcel } from "./decrypt";
import { Logger } from "./log";

const CDP_HOST = "127.0.0.1"; // 외부 노출 금지 — 로컬 전용

// ---- 브라우저 실행 파일 탐색 ----

function browserCandidates(cfg: CollectorConfig): string[] {
  if (cfg.browser.executablePath) return [expandEnv(cfg.browser.executablePath)];
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] ?? "";
  if (cfg.browser.channel === "whale") {
    return [
      path.join(pf, "Naver", "Naver Whale", "Application", "whale.exe"),
      path.join(pf86, "Naver", "Naver Whale", "Application", "whale.exe"),
      path.join(local, "Naver", "Naver Whale", "Application", "whale.exe"),
    ];
  }
  return [
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
  ];
}

// ---- CDP ----

async function cdpAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${CDP_HOST}:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureBrowser(cfg: CollectorConfig, log: Logger): Promise<void> {
  const port = cfg.browser.debugPort;
  if (await cdpAlive(port)) {
    log.info(`1/6 이미 실행 중인 브라우저에 연결합니다 (포트 ${port})`);
    return;
  }
  const exe = browserCandidates(cfg).find((p) => fs.existsSync(p));
  if (!exe) {
    throw new Error(
      `브라우저 실행 파일을 찾을 수 없습니다 (${cfg.browser.channel}). config.json의 browser.executablePath에 경로를 입력해 주세요.`
    );
  }
  const profile = expandEnv(cfg.browser.profileDir);
  fs.mkdirSync(profile, { recursive: true });
  log.info(`1/6 브라우저를 수집 전용 프로필로 실행합니다`);
  // "브라우저 열기" 바로가기(.bat)와 동일한 명령 — 상시 브라우저와 프로필 분리
  spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      cfg.bookingUrl,
    ],
    { detached: true, stdio: "ignore" }
  ).unref();

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await cdpAlive(port)) return;
  }
  throw new Error("브라우저 디버그 포트에 연결하지 못했습니다. 브라우저를 모두 닫고 다시 실행해 주세요.");
}

// ---- 다운로드 폴더 감시 ----

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

async function waitForDownload(
  dir: string,
  pattern: string,
  timeoutSec: number,
  sinceMs: number,
  log: Logger
): Promise<string> {
  const re = patternToRegex(pattern);
  const deadline = Date.now() + timeoutSec * 1000;
  const lastSizes = new Map<string, number>();

  while (Date.now() < deadline) {
    await sleep(500);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      throw new Error(`다운로드 폴더를 읽을 수 없습니다: ${dir}`);
    }
    for (const name of names) {
      if (!re.test(name)) continue;
      if (names.includes(`${name}.crdownload`)) continue; // 다운로드 진행 중
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.mtimeMs < sinceMs) continue; // 클릭 이전의 옛 파일
      // 크기가 두 번 연속 같아야 완료로 판정
      const prev = lastSizes.get(full);
      lastSizes.set(full, stat.size);
      if (prev !== undefined && prev === stat.size && stat.size > 0) {
        log.info(`5/6 다운로드 완료 감지: ${name}`);
        return full;
      }
    }
  }
  throw new Error(`시간 초과(${timeoutSec}초): 다운로드된 파일을 찾지 못했습니다.`);
}

// ---- 업로드 ----

interface UploadResult {
  batchId?: string;
  total?: number;
  new?: number;
  updated?: number;
  cancelled?: number;
  skipped?: number;
  errors?: number;
  error?: string;
  code?: string;
}

async function upload(cfg: CollectorConfig, buf: Buffer, fileName: string): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)]), fileName);
  form.append("mode", "auto_apply");
  const res = await fetch(`${cfg.apiBaseUrl.replace(/\/$/, "")}/api/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.collectorToken}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json().catch(() => ({}))) as UploadResult;
  if (!res.ok) {
    throw new UploadError(data.error ?? `업로드 실패 (HTTP ${res.status})`, data.code);
  }
  return data;
}

class UploadError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 더블클릭 실행 시 결과를 읽을 수 있도록 종료 전 대기
async function pauseBeforeExit() {
  if (!process.stdin.isTTY) return;
  console.log("\n아무 키나 누르면 창이 닫힙니다...");
  await new Promise<void>((resolve) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
  process.stdin.pause();
}

// ---- 메인 ----

async function main(log: Logger): Promise<number> {
  let browser: Browser | null = null;
  try {
    log.info("=== 수집 시작 ===");
    const cfg = loadConfig();

    // 1/6 CDP 접속 (없으면 전용 프로필로 실행)
    await ensureBrowser(cfg, log);
    browser = await chromium.connectOverCDP(`http://${CDP_HOST}:${cfg.browser.debugPort}`);
    const context = browser.contexts()[0] ?? (await browser.newContext());

    // 2/6 예약자관리 이동
    log.info("2/6 예약자관리 페이지로 이동합니다");
    let page: Page =
      context.pages().find((p) => p.url().includes("partner.booking.naver.com")) ??
      (await context.newPage());
    await page.bringToFront();
    await page.goto(cfg.bookingUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

    // 3/6 로그인 감지 — 자격증명 입력은 하지 않는다
    if (page.url().includes(cfg.selectors.loginDetect)) {
      log.error("네이버 로그인이 필요합니다. 열린 브라우저에서 로그인한 뒤 다시 실행해 주세요.");
      return 2;
    }
    log.info("3/6 로그인 상태 확인 완료");

    // 4/6 "상세 내려받기" 클릭 (기간은 기본값 '이용일·한달' — 조작하지 않음)
    const btn = page.locator(cfg.selectors.detailDownloadBtn).first();
    try {
      await btn.waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      log.error(
        `"상세 내려받기" 버튼을 찾지 못했습니다. 네이버 화면이 바뀌었을 수 있습니다 — config.json의 selectors.detailDownloadBtn을 확인해 주세요.`
      );
      return 3;
    }
    const clickedAt = Date.now();
    await btn.click();
    log.info("4/6 상세 내려받기 버튼 클릭");

    // 5/6 다운로드 폴더 감시
    const dir = expandEnv(cfg.download.dir);
    let filePath: string;
    try {
      filePath = await waitForDownload(
        dir,
        cfg.download.filePattern,
        cfg.download.timeoutSec,
        clickedAt - 3000,
        log
      );
    } catch (e) {
      log.error(e instanceof Error ? e.message : "다운로드 감시 실패");
      return 4;
    }

    // 6/6 (선택) 로컬 복호화 → 업로드. 원본 파일은 어떤 경우에도 삭제하지 않는다.
    let buf: Buffer = fs.readFileSync(filePath);
    const password = cfg.download.excelPassword?.trim();
    if (password && isEncryptedExcel(buf)) {
      try {
        buf = await decryptExcel(buf, password);
        log.info("6/6 로컬 복호화 완료");
      } catch {
        log.error("복호화에 실패했습니다 (원본은 보존됨). config.json의 excelPassword를 확인해 주세요.");
        return 5;
      }
    }

    log.info("6/6 대시보드로 업로드합니다 (auto_apply)");
    let result: UploadResult;
    try {
      result = await upload(cfg, buf, path.basename(filePath));
    } catch (e) {
      if (e instanceof UploadError && e.code === "password_not_set") {
        log.error("대시보드에 파일 비밀번호가 등록되어 있지 않습니다. 엑셀 업로드 화면의 설정 카드에서 등록해 주세요.");
      } else if (e instanceof UploadError && e.code === "password_mismatch") {
        log.error("파일 비밀번호가 맞지 않습니다. 대시보드의 비밀번호 설정을 확인해 주세요.");
      } else {
        log.error(e instanceof Error ? e.message : "업로드 실패");
      }
      return 6;
    }

    // 결과 — 건수만 기록 (개인정보 금지)
    log.info(
      `완료: 예약 ${result.total ?? 0}건 중 신규 ${result.new ?? 0}·변경 ${result.updated ?? 0} 반영` +
        ` (취소 ${result.cancelled ?? 0} · 변경 없음 ${result.skipped ?? 0} · 오류 제외 ${result.errors ?? 0})`
    );
    log.info("=== 수집 종료 (성공) ===");
    return 0;
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    // CDP 연결만 끊는다 — 대표의 브라우저·로그인 세션은 그대로 유지
    await browser?.close().catch(() => undefined);
  }
}

void (async () => {
  const log = new Logger(baseDir());
  const code = await main(log);
  await pauseBeforeExit();
  process.exit(code);
})();
