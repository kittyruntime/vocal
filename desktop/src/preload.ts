import { contextBridge, ipcRenderer } from "electron";

// The only surface the renderer (the same web app served over HTTP, running
// with contextIsolation) gets into the desktop app. Deliberately thin: no
// direct fs/safeStorage access here, everything goes through the main
// process via IPC so a compromised/malicious renderer can't do more than
// these four things.
contextBridge.exposeInMainWorld("vocalDesktop", {
  getConfig: () => ipcRenderer.invoke("desktop:get-config"),
  setConfig: (config: { serverUrl: string; token: string | null }) => ipcRenderer.invoke("desktop:set-config", config),
  clearConfig: () => ipcRenderer.invoke("desktop:clear-config"),
  notify: (title: string, body: string) => ipcRenderer.invoke("desktop:notify", title, body),
});
