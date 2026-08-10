import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";
import { ApiError } from "../api/client";

export function LoginScreen({ onShowRegister }: { onShowRegister(): void }) {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Connexion</h1>
        <label htmlFor="login-username">Nom d'utilisateur</label>
        <input id="login-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <label htmlFor="login-password">Mot de passe</label>
        <input
          id="login-password"
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
          Se connecter
        </button>
        <button type="button" className="auth-link" onClick={onShowRegister}>
          Créer un compte
        </button>
      </form>
    </div>
  );
}
