import { app, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

// electron-updater checks every 4h in addition to the startup check -- the
// app can stay resident in the tray for days across voice calls, so a
// single check per launch isn't enough to ever reach most users.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Update failures (no signed build on macOS yet, no network, no release
// found, ...) are expected and must never interrupt the app -- logged
// best-effort to the same crash.log main.ts's reportFatal writes to, never
// shown to the user.
function logUpdateError(context: string, err: unknown): void {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const line = `[${new Date().toISOString()}] updater ${context}: ${message}\n`;
  try {
    appendFileSync(join(app.getPath("userData"), "crash.log"), line);
  } catch {
    /* best effort -- still logged to console below */
  }
  console.error(line);
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err) => logUpdateError("checkForUpdates", err));
}

export function restartToInstallUpdate(): void {
  autoUpdater.quitAndInstall();
}

// Wires electron-updater in: silent background download, a native
// notification once one's ready, and `onUpdateReady` so the caller (the
// tray menu, in main.ts) can reflect the ready state too. No-ops entirely
// outside a packaged build (no update checks in dev).
export function initUpdater(onUpdateReady: (version: string) => void): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-downloaded", (info) => {
    onUpdateReady(info.version);
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: "Update ready",
        body: `Vocal v${info.version} has been downloaded. Click to restart and install it.`,
      });
      notification.on("click", () => restartToInstallUpdate());
      notification.show();
    }
  });
  autoUpdater.on("error", (err) => logUpdateError("event", err));

  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}
