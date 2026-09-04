import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, Tray, session, desktopCapturer } from "electron";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { clearConfig, loadConfig, saveConfig, type DesktopConfig } from "./config";
import { startStaticServer } from "./staticServer";
import { checkForUpdates, initUpdater, restartToInstallUpdate } from "./updater";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let updateReadyVersion: string | null = null;

// A packaged GUI app has no visible console -- a startup exception a user
// hits (as opposed to one caught locally in dev) previously just closed the
// window with no way to tell us what happened. Logs to userData/crash.log
// AND shows a dialog (once app.whenReady() has resolved; before that a
// dialog can't be shown, so the log file is the only record) instead of
// silently dying.
function reportFatal(context: string, err: unknown): void {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const line = `[${new Date().toISOString()}] ${context}: ${message}\n`;
  try {
    appendFileSync(join(app.getPath("userData"), "crash.log"), line);
  } catch {
    /* best effort -- still try to surface the dialog below */
  }
  console.error(line);
  if (app.isReady()) {
    dialog.showErrorBox("Vocal failed to start", `${context}\n\n${message}`);
  }
}

process.on("uncaughtException", (err) => reportFatal("uncaughtException", err));
process.on("unhandledRejection", (err) => reportFatal("unhandledRejection", err));

// A second launch (double-clicking the icon, or a shortcut) should focus the
// existing window instead of opening a duplicate instance against the same
// local config file.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(main).catch((err) => {
    reportFatal("startup", err);
    app.quit();
  });
}

async function main(): Promise<void> {
  // Electron denies every permission request by default. Auto-granting
  // media (microphone/camera) here is the actual fix for the reported
  // Firefox problem -- getUserMedia works reliably in this Chromium-based
  // shell without any of the flaky site-permission-prompt behavior.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "notifications");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" || permission === "notifications";
  });
  // getDisplayMedia (screen share) has no browser-style picker in Electron;
  // auto-select the primary screen. Good enough for a first pass -- a
  // window/screen picker UI is a reasonable follow-up, not required for the
  // app to work.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    let sources: Electron.DesktopCapturerSource[] = [];
    try {
      sources = await desktopCapturer.getSources({ types: ["screen"] });
    } catch (err) {
      console.error("[display-media] desktopCapturer.getSources failed:", err);
    }
    const primary = sources[0];
    if (!primary) {
      console.error("[display-media] no screen sources available (OS permission missing or Wayland restriction?)");
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "Screen sharing unavailable",
          message: "No screen was found to share.",
          detail: "If you are on macOS, allow Screen Recording for Vocal in System Settings > Privacy & Security. On Linux/Wayland, screen capture may be restricted to the system picker.",
        }).catch(() => {});
      }
      return;
    }
    callback({ video: primary, audio: "loopback" });
  }, { useSystemPicker: true });

  const startUrl = await resolveStartUrl();
  createWindow(startUrl);
  createTray();
  initUpdater((version) => {
    updateReadyVersion = version;
    rebuildTrayMenu();
  });

  ipcMain.handle("desktop:get-config", (): DesktopConfig | null => loadConfig());
  ipcMain.handle("desktop:set-config", (_event, config: DesktopConfig) => saveConfig(config));
  ipcMain.handle("desktop:clear-config", () => clearConfig());
  ipcMain.handle("desktop:notify", (_event, title: string, body: string) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    notification.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    notification.show();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(startUrl);
    else mainWindow?.show();
  });
}

// In dev (VOCAL_WEB_DEV_URL set, e.g. by `npm run dev`) loads the Vite dev
// server directly for hot reload. In production, serves the bundled
// web/dist build over a local http server (see staticServer.ts) rather than
// file://, so the renderer has a real, stable origin.
async function resolveStartUrl(): Promise<string> {
  const devUrl = process.env.VOCAL_WEB_DEV_URL;
  if (devUrl) return devUrl;
  const webDist = join(__dirname, "..", "web-dist");
  const port = await startStaticServer(webDist);
  return `http://127.0.0.1:${port}/`;
}

function createWindow(startUrl: string): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: "Vocal",
    icon: join(__dirname, "..", "build", "icon.png"),
    // The default File/Edit/View/Window/Help menu has no custom items and
    // is pure clutter for a chat/voice app -- hide it (Alt still reveals it
    // if someone needs it). No-op on macOS, which has no per-window menu
    // bar to begin with.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void mainWindow.loadURL(startUrl);

  // Closing the window never quits the app (so a voice call keeps running
  // in the background) -- only the tray's "Quit" item, or the OS asking
  // every window to close before an actual app quit, does.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// The tray icon is a nice-to-have (background voice calls, quick reopen) --
// it must never be able to take the whole app down if icon loading or Tray
// construction fails for some reason on a given machine.
function createTray(): void {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip("Vocal");
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
    tray.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
  } catch (err) {
    reportFatal("createTray (non-fatal, continuing without a tray icon)", err);
    tray = null;
  }
}

// Rebuilt whenever `updateReadyVersion` changes (see initUpdater's
// onUpdateReady callback in main()) so a "restart to update" item can
// appear without recreating the Tray itself.
function trayMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (updateReadyVersion) {
    items.push(
      { label: `Restart to update (v${updateReadyVersion})`, click: () => restartToInstallUpdate() },
      { type: "separator" },
    );
  }
  items.push(
    { label: "Open Vocal", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "Check for Updates", click: () => checkForUpdates() },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  );
  return items;
}

function rebuildTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function trayIcon() {
  return join(__dirname, "..", "build", "tray.png");
}

app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  // Deliberately not calling app.quit() here (even on non-macOS): the tray
  // is the point, the app should keep running with the window merely
  // hidden. See the close handler above -- this event only fires once every
  // window is actually destroyed, e.g. after "Quit" already set `quitting`.
});
