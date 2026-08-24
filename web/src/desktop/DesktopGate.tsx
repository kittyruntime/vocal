import { useEffect, useState, type ReactNode } from "react";
import * as api from "../api/client";
import { desktopBridge, isDesktop } from "./bridge";
import { ConnectScreen } from "./ConnectScreen";

// Sits above AuthProvider so a server is always configured (base URL +
// possibly a stored token) before anything below it makes its first API
// call. A no-op passthrough outside the desktop app.
export function DesktopGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isDesktop());
  const [connected, setConnected] = useState(!isDesktop());

  useEffect(() => {
    if (!isDesktop()) return;
    void desktopBridge()
      .getConfig()
      .then((config) => {
        if (config) {
          api.setServerBase(config.serverUrl);
          api.setAuthToken(config.token);
          setConnected(true);
        }
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="auth-loading">Loading…</div>;
  if (!connected) return <ConnectScreen onConnected={() => setConnected(true)} />;
  return <>{children}</>;
}
