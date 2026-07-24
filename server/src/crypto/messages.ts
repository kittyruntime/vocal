import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const NONCE_LEN = 12;
const TAG_LEN = 16;

export function encryptMessage(plaintext: string, key: Buffer): string {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const withTag = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return `${VERSION}:${nonce.toString("base64")}:${withTag.toString("base64")}`;
}

export function decryptMessage(payload: string, key: Buffer): string {
  const [version, nonceB64, dataB64] = payload.split(":");
  if (version !== VERSION) throw new Error(`unknown encryption version: ${version}`);
  const nonce = Buffer.from(nonceB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const ciphertext = data.subarray(0, data.length - TAG_LEN);
  const tag = data.subarray(data.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function loadMasterKey(): Buffer {
  const raw = process.env.MESSAGE_MASTER_KEY;
  if (!raw) throw new Error("MESSAGE_MASTER_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MESSAGE_MASTER_KEY must be 32 bytes (base64)");
  return key;
}
