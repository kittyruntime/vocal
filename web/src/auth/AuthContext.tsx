import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import type { CurrentUser } from "../api/client";

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
  signUp(inviteToken: string, username: string, password: string): Promise<void>;
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
        err instanceof ApiError ? err.message : "Impossible de contacter le serveur. Vérifie ta connexion.";
      setState({ phase: "error", message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const completeSetup = useCallback(
    async (username: string, password: string) => {
      await api.setup(username, password);
      await refresh();
    },
    [refresh],
  );

  const signIn = useCallback(
    async (username: string, password: string) => {
      await api.login(username, password);
      await refresh();
    },
    [refresh],
  );

  const signUp = useCallback(
    async (inviteToken: string, username: string, password: string) => {
      await api.register(inviteToken, username, password);
      // The invite token is single-use; strip it from the URL so it doesn't linger in the
      // address bar, browser history, or outbound Referer headers after account creation.
      window.history.replaceState({}, "", window.location.pathname);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await api.logout();
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
