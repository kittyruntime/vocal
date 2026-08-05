import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import type { CurrentUser } from "../api/client";
import { SetupScreen } from "./SetupScreen";
import { LoginScreen } from "./LoginScreen";
import { RegisterScreen } from "./RegisterScreen";

export function AuthGate({ children }: { children(user: CurrentUser): ReactNode }) {
  const { state, refresh } = useAuth();

  if (state.phase === "loading") return <div className="auth-loading">Chargement…</div>;
  if (state.phase === "error") {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-error-screen">
          <h1>Connexion impossible</h1>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={() => void refresh()}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }
  if (state.phase === "needs-setup") return <SetupScreen />;
  if (state.phase === "signed-out") {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    return invite ? <RegisterScreen inviteToken={invite} /> : <LoginScreen />;
  }
  return <>{children(state.user)}</>;
}
