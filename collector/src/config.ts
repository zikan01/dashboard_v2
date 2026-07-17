// config.json 로드 — exe와 같은 폴더(패키징) 또는 collector/ (개발)
// 토큰·비밀번호가 들어가므로 config 내용은 절대 로그에 출력하지 않는다.

import * as fs from "fs";
import * as path from "path";

export interface CollectorConfig {
  apiBaseUrl: string;
  collectorToken: string;
  bookingUrl: string;
  browser: {
    channel: "chrome" | "whale";
    executablePath: string;
    debugPort: number;
    profileDir: string;
  };
  download: {
    dir: string;
    filePattern: string;
    timeoutSec: number;
    /** 비워두면 서버(/api/import)가 등록된 비밀번호로 복호화한다 */
    excelPassword?: string;
  };
  selectors: {
    detailDownloadBtn: string;
    loginDetect: string;
  };
  period: { basis: string; range: string };
}

// "%USERPROFILE%\\Downloads" 같은 윈도우 환경변수 표기 확장
export function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`);
}

// pkg로 패키징되면 process.pkg가 존재 — 이때 기준 폴더는 exe 위치
export function baseDir(): string {
  return (process as NodeJS.Process & { pkg?: unknown }).pkg
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, "..");
}

export function loadConfig(): CollectorConfig {
  const file = path.join(baseDir(), "config.json");
  if (!fs.existsSync(file)) {
    throw new Error(`설정 파일을 찾을 수 없습니다: ${file}`);
  }
  let cfg: CollectorConfig;
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("config.json이 올바른 JSON이 아닙니다. 따옴표·쉼표를 확인해 주세요.");
  }
  for (const key of ["apiBaseUrl", "collectorToken", "bookingUrl"] as const) {
    if (!cfg[key] || String(cfg[key]).includes("여기에")) {
      throw new Error(`config.json의 ${key} 값을 입력해 주세요.`);
    }
  }
  if (!cfg.browser?.debugPort || !cfg.download?.dir || !cfg.selectors?.detailDownloadBtn) {
    throw new Error("config.json의 browser/download/selectors 설정이 비어 있습니다.");
  }
  return cfg;
}
