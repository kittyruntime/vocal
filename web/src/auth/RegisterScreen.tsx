import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";
import { ApiError } from "../api/client";

export function RegisterScreen({ inviteToken, onShowLogin }: { inviteToken?: string; onShowLogin(): void }) {
  const { signUp } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signUp(username, password, inviteToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Rejoindre Vocal</h1>
        <label htmlFor="register-username">Nom d'utilisateur</label>
        <input id="register-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <label htmlFor="register-password">Mot de passe</label>
        <input
          id="register-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          Créer mon compte
        </button>
        <button type="button" className="auth-link" onClick={onShowLogin}>
          J’ai déjà un compte
        </button>
      </form>
    </div>
  );
}
