// officecrypto-tool 래퍼 (웹 /api/import와 같은 라이브러리 — TRD §1 공용 결정)
// config에 excelPassword가 있으면 수집기가 로컬에서 복호화하고,
// 비워두면 암호화된 원본을 그대로 업로드해 서버가 등록된 비밀번호로 복호화한다.

import * as officeCrypto from "officecrypto-tool";

export function isEncryptedExcel(buf: Buffer): boolean {
  try {
    return officeCrypto.isEncrypted(buf);
  } catch {
    return false;
  }
}

/** 실패 시 예외 — 호출부는 원본 파일을 보존하고 안내 후 종료한다 */
export async function decryptExcel(buf: Buffer, password: string): Promise<Buffer> {
  return officeCrypto.decrypt(buf, { password });
}
