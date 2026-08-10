import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";
import { ApiError } from "../api/client";

export function SetupScreen() {
  const { completeSetup } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await completeSetup(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Welcome to Vocal</h1>
        <p>Create the first account: it will be an administrator.</p>
        <label htmlFor="setup-username">Username</label>
        <input id="setup-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <label htmlFor="setup-password">Password</label>
        <input
          id="setup-password"
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
          Create admin account
        </button>
      </form>
    </div>
  );
}
