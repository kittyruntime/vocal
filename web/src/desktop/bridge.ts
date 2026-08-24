// Typed wrapper around the API the Electron preload script exposes via
// contextBridge (see desktop/src/preload.ts). Only present when this page is
// running inside the desktop app; a plain browser tab never has this global,
// so every consumer must check isDesktop() first.
export type DesktopConfig = { serverUrl: string; token: string | null };

export type DesktopBridge = {
  getConfig(): Promise<DesktopConfig | null>;
  setConfig(config: DesktopConfig): Promise<void>;
  clearConfig(): Promise<void>;
};

declare global {
  interface Window {
    vocalDesktop?: DesktopBridge;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.vocalDesktop !== undefined;
}

export function desktopBridge(): DesktopBridge {
  if (!window.vocalDesktop) throw new Error("not running inside the desktop app");
  return window.vocalDesktop;
}
