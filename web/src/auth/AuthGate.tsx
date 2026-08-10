import { useEffect, useState, type ReactNode } from "react";
import * as api from "../api/client";
import { useAuth } from "./AuthContext";
import type { CurrentUser } from "../api/client";
import { SetupScreen } from "./SetupScreen";
import { LoginScreen } from "./LoginScreen";
import { RegisterScreen } from "./RegisterScreen";

export function AuthGate({ children }: { children(user: CurrentUser): ReactNode }) {
  const { state, refresh } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const invite = params.get("invite") ?? undefined;
  const [showRegister, setShowRegister] = useState(Boolean(invite));
  const [registrationOpen, setRegistrationOpen] = useState(true);
  useEffect(() => { void api.getRegistrationStatus().then((value) => setRegistrationOpen(value.registrationOpen)).catch(() => {}); }, []);

  if (state.phase === "loading") return <div className="auth-loading">Loading…</div>;
  if (state.phase === "error") {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-error-screen">
          <h1>Unable to connect</h1>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (state.phase === "needs-setup") return <SetupScreen />;
  if (state.phase === "signed-out") {
    return showRegister
      ? <RegisterScreen inviteToken={invite} onShowLogin={() => setShowRegister(false)} />
      : <LoginScreen registrationOpen={registrationOpen} onShowRegister={() => setShowRegister(true)} />;
  }
  return <>{children(state.user)}</>;
}
