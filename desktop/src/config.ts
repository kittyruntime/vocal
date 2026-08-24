import { app, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type DesktopConfig = { serverUrl: string; token: string | null };

type StoredConfig = { serverUrl: string; tokenEncrypted: string | null };

function configPath(): string {
  return join(app.getPath("userData"), "connection.json");
}

// The token is the one genuinely sensitive value here (it authenticates as
// the user for up to 30 days); it's encrypted at rest with the OS keychain
// (DPAPI on Windows, Keychain on macOS, libsecret on Linux) via safeStorage.
// serverUrl is not a secret and stays plain, which also keeps the file
// readable for debugging.
export function loadConfig(): DesktopConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const stored = JSON.parse(readFileSync(path, "utf8")) as StoredConfig;
    let token: string | null = null;
    if (stored.tokenEncrypted) {
      token = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(stored.tokenEncrypted, "base64"))
        : stored.tokenEncrypted; // fell back to plaintext on write (see below)
    }
    return { serverUrl: stored.serverUrl, token };
  } catch {
    return null;
  }
}

export function saveConfig(config: DesktopConfig): void {
  const tokenEncrypted = config.token
    ? (safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(config.token).toString("base64")
        : config.token)
    : null;
  const stored: StoredConfig = { serverUrl: config.serverUrl, tokenEncrypted };
  writeFileSync(configPath(), JSON.stringify(stored), "utf8");
}

export function clearConfig(): void {
  const path = configPath();
  if (existsSync(path)) unlinkSync(path);
}
