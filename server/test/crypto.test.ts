import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptMessage, decryptMessage, loadMasterKey } from "../src/crypto/messages.js";

const key = randomBytes(32);

describe("message encryption", () => {
  it("roundtrips plaintext", () => {
    const payload = encryptMessage("salut les copains 🎧", key);
    expect(decryptMessage(payload, key)).toBe("salut les copains 🎧");
  });

  it("produces the v1 format with unique nonces", () => {
    const a = encryptMessage("x", key);
    const b = encryptMessage("x", key);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext", () => {
    const payload = encryptMessage("secret", key);
    const parts = payload.split(":");
    const cipher = Buffer.from(parts[2], "base64");
    cipher[0] ^= 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${cipher.toString("base64")}`;
    expect(() => decryptMessage(tampered, key)).toThrow();
  });

  it("rejects unknown version", () => {
    expect(() => decryptMessage("v9:AAAA:AAAA", key)).toThrow(/version/);
  });

  it("loadMasterKey validates size", () => {
    process.env.MESSAGE_MASTER_KEY = randomBytes(32).toString("base64");
    expect(loadMasterKey().length).toBe(32);
    process.env.MESSAGE_MASTER_KEY = "dG9vLXNob3J0";
    expect(() => loadMasterKey()).toThrow(/32/);
  });
});
