// 실행 로그 — collector/logs/YYYY-MM-DD.log
// ⚠️ 개인정보(이름·전화번호 등) 기록 금지 — 단계·건수·사유만 남긴다 (TRD §8)
// 30일 지난 로그는 실행 시 자동 삭제

import * as fs from "fs";
import * as path from "path";

const KEEP_DAYS = 30;

export class Logger {
  private file: string;

  constructor(base: string) {
    const dir = path.join(base, "logs");
    fs.mkdirSync(dir, { recursive: true });
    this.cleanup(dir);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    this.file = path.join(dir, `${stamp}.log`);
  }

  info(message: string) {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    try {
      fs.appendFileSync(this.file, line + "\n", "utf8");
    } catch {
      // 로그 기록 실패가 수집을 막지 않도록 무시
    }
  }

  error(message: string) {
    this.info(`[오류] ${message}`);
  }

  private cleanup(dir: string) {
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".log")) continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      }
    } catch {
      // 정리 실패는 치명적이지 않음
    }
  }
}
