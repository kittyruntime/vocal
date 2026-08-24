import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import type { CurrentUser } from "../api/client";
import { applyServerDefaultAccent } from "../theme/accent";
import { desktopBridge, isDesktop } from "../desktop/bridge";

// Persists the session token alongside the configured server so a relaunch
// skips straight back to signed-in. No-op on the regular web client, which
// authenticates via the cookie these same responses also set.
async function rememberDesktopSession(token: string): Promise<void> {
  if (!isDesktop()) return;
  const serverUrl = api.getServerBase();
  if (!serverUrl) return;
  api.setAuthToken(token);
  await desktopBridge().setConfig({ serverUrl, token });
}

type AuthState =
  | { phase: "loading" }
  | { phase: "needs-setup" }
  | { phase: "signed-out" }
  | { phase: "signed-in"; user: CurrentUser }
  | { phase: "error"; message: string };

type AuthContextValue = {
  state: AuthState;
  refresh(): Promise<void>;
  completeSetup(username: string, password: string): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  signUp(username: string, password: string, inviteToken?: string): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ phase: "loading" });

  const refresh = useCallback(async () => {
    try {
      const status = await api.getSetupStatus();
      if (!status.done) {
        setState({ phase: "needs-setup" });
        return;
      }
      try {
        const user = await api.getMe();
        setState({ phase: "signed-in", user });
      } catch {
        setState({ phase: "signed-out" });
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not reach the server. Check your connection.";
      setState({ phase: "error", message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const completeSetup = useCallback(
    async (username: string, password: string) => {
      const { token } = await api.setup(username, password);
      await rememberDesktopSession(token);
      await refresh();
    },
    [refresh],
  );

  const signIn = useCallback(
    async (username: string, password: string) => {
      const { token } = await api.login(username, password);
      await rememberDesktopSession(token);
      await refresh();
    },
    [refresh],
  );

  const signUp = useCallback(
    async (username: string, password: string, inviteToken?: string) => {
      const { token } = await api.register(username, password, inviteToken);
      await rememberDesktopSession(token);
      // Strip a legacy invite token from the URL after account creation.
      window.history.replaceState({}, "", window.location.pathname);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    if (isDesktop()) {
      // Forget the session but keep the configured server, so a relaunch
      // goes straight to the login screen instead of "enter a server" again.
      const serverUrl = api.getServerBase();
      api.setAuthToken(null);
      if (serverUrl) await desktopBridge().setConfig({ serverUrl, token: null });
    }
    try {
      await applyServerDefaultAccent();
    } catch {
      /* cosmetic reset; never block sign-out */
    }
    setState({ phase: "signed-out" });
  }, []);

  const value = useMemo(
    () => ({ state, refresh, completeSetup, signIn, signUp, signOut }),
    [state, refresh, completeSetup, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
