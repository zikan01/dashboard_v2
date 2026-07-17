// officecrypto-tool은 타입 정의를 제공하지 않음 — 사용하는 표면만 선언
declare module "officecrypto-tool" {
  export function decrypt(input: Buffer, options: { password: string }): Promise<Buffer>;
  export function encrypt(input: Buffer, options: { password: string }): Promise<Buffer>;
  export function isEncrypted(input: Buffer): boolean;
}
