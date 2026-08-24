import { useState, type FormEvent } from "react";
import * as api from "../api/client";
import { TextField } from "../ui/form";
import { Wordmark } from "../ui/Wordmark";

// Shown once, on first launch of the desktop app (or after "Forget this
// server"): asks for the self-hosted server's URL before anything else can
// happen, since every other screen assumes one is already configured.
export function ConnectScreen({ onConnected }: { onConnected(serverUrl: string): void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    try {
      const normalized = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
      const ok = await api.connectToServer(normalized);
      if (!ok) {
        setError("Could not reach a Vocal server at this address.");
        return;
      }
      onConnected(normalized);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <Wordmark size={26} />
        <h1>Connect to a server</h1>
        <TextField
          label="Server address"
          placeholder="vocal.example.com"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={submitting || !url.trim()}>
          {submitting ? "Connecting…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
