import { app, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// electron-updater checks every 4h in addition to the startup check -- the
// app can stay resident in the tray for days across voice calls, so a
// single check per launch isn't enough to ever reach most users.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Version whose "update ready" notification has already been shown, so the
// re-emitted `update-downloaded` events don't re-notify. See the handler.
let notifiedVersion: string | null = null;

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

// electron-builder writes a `package-type` marker file into the app's
// resources for its deb/rpm targets, and electron-updater keys off exactly
// that file to swap AppImageUpdater out for DebUpdater/RpmUpdater -- updaters
// that shell out to `pkexec`/`gksudo`/`sudo` to run `dpkg -i`, i.e. a
// graphical root-password prompt. System-package auto-update is explicitly
// out of scope (design doc: "`.deb` auto-update (electron-updater does not
// support it on Linux)"), and `desktop/README.md` tells `.deb` users to
// reinstall manually. Every electron-updater 6.x ships and dispatches
// DebUpdater, so this has to be refused here rather than by pinning the
// dependency. AppImage builds carry no marker and update normally.
let systemPackageInstall: boolean | null = null;
function isSystemPackageInstall(): boolean {
  if (systemPackageInstall === null) {
    try {
      // A running AppImage always sets APPIMAGE (it's how AppImageUpdater
      // itself locates the file to patch). Checking it first keeps the marker
      // check from ever misfiring: electron-builder writes `package-type`
      // into the shared linux-unpacked/ directory the AppImage is also built
      // from, so which of the two targets is built first decides whether the
      // AppImage ends up carrying a stray marker.
      systemPackageInstall =
        !process.env.APPIMAGE && existsSync(join(process.resourcesPath, "package-type"));
    } catch {
      systemPackageInstall = false;
    }
  }
  return systemPackageInstall;
}

export function checkForUpdates(): void {
  if (isSystemPackageInstall()) return;
  autoUpdater
    .checkForUpdates()
    .then((result) => {
      // With autoDownload on, the resolved result carries a *separate*
      // download promise that electron-updater never attaches a handler to.
      // Left alone, a failed download (unsigned macOS build, network drop)
      // becomes an unhandledRejection, which main.ts turns into a blocking
      // "Vocal failed to start" dialog. Update failures stay silent.
      result?.downloadPromise?.catch((err) => logUpdateError("downloadUpdate", err));
    })
    .catch((err) => logUpdateError("checkForUpdates", err));
}

// quitAndInstall can throw synchronously (MacUpdater when Squirrel isn't in a
// ready state). This runs from tray/notification click handlers, where an
// uncaught throw would reach main.ts's uncaughtException handler and show the
// same bogus fatal dialog.
export function restartToInstallUpdate(): void {
  try {
    autoUpdater.quitAndInstall();
  } catch (err) {
    logUpdateError("quitAndInstall", err);
  }
}

// Wires electron-updater in: silent background download, a native
// notification once one's ready, and `onUpdateReady` so the caller (the
// tray menu, in main.ts) can reflect the ready state too. No-ops entirely
// outside a packaged build (no update checks in dev).
export function initUpdater(onUpdateReady: (version: string) => void): void {
  if (!app.isPackaged) return;
  if (isSystemPackageInstall()) {
    console.info("updater: system-package install (deb/rpm), auto-update disabled");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-downloaded", (info) => {
    // Once an update is cached, every subsequent periodic check re-emits
    // `update-downloaded` without re-downloading, so notify only once per
    // version -- otherwise a user who doesn't restart collects a toast every
    // 4h. `onUpdateReady` stays unconditional: it's idempotent and keeps the
    // tray menu correct.
    onUpdateReady(info.version);
    if (notifiedVersion === info.version) return;
    notifiedVersion = info.version;
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
