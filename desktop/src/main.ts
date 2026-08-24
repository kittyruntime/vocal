import { app, BrowserWindow, ipcMain, Menu, Notification, Tray, session, desktopCapturer } from "electron";
import { join } from "node:path";
import { clearConfig, loadConfig, saveConfig, type DesktopConfig } from "./config";
import { startStaticServer } from "./staticServer";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

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
    console.error("failed to start", err);
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
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    callback({ video: sources[0], audio: "loopback" });
  }, { useSystemPicker: true });

  const startUrl = await resolveStartUrl();
  createWindow(startUrl);
  createTray();

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

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip("Vocal");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Vocal", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

function trayIcon() {
  // A bundled real icon (converted from web/public/favicon.svg) is a
  // follow-up; Electron's own default icon is used until then.
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
