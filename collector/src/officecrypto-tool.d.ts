declare module "officecrypto-tool" {
  export function decrypt(input: Buffer, options: { password: string }): Promise<Buffer>;
  export function encrypt(input: Buffer, options: { password: string }): Promise<Buffer>;
  export function isEncrypted(input: Buffer): boolean;
}
