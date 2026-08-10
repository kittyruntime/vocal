import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { CurrentUser } from "../api/client";
import * as api from "../api/client";
import { Icon } from "../ui/Icon";

const MAX_AVATAR_BYTES = 512 * 1024;

export function ProfileModal({ currentUser, onClose, onSaved }: {
  currentUser: CurrentUser;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const [username, setUsername] = useState(currentUser.username);
  const [email, setEmail] = useState(currentUser.email ?? "");
  const [description, setDescription] = useState(currentUser.description ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      setError("Choose a PNG, JPEG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("The profile picture must be smaller than 512 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(typeof reader.result === "string" ? reader.result : null);
      setError("");
    };
    reader.onerror = () => setError("The image could not be read.");
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await api.updateProfile({ username: username.trim(), email: email.trim() || null, description: description.trim(), avatarUrl });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The profile could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="voice-modal-backdrop profile-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="voice-settings-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header>
          <div><span>USER SETTINGS</span><h2 id="profile-title">My profile</h2></div>
          <button type="button" className="modal-close" aria-label="Close profile settings" onClick={onClose} disabled={saving}><Icon name="close" size={18} /></button>
        </header>
        <form className="profile-form" onSubmit={submit}>
          <div className="profile-preview">
            <div className="profile-banner" />
            <div className="profile-preview-body">
              <button type="button" className="profile-avatar-button" onClick={() => fileInputRef.current?.click()} aria-label="Change profile picture">
                {avatarUrl ? <img src={avatarUrl} alt="Profile preview" /> : <span>{username.slice(0, 1).toUpperCase() || "?"}</span>}
                <i><Icon name="camera" size={16} /></i>
              </button>
              <strong>{username || "Username"}</strong>
              <p>{description || "Add a short description about yourself."}</p>
            </div>
          </div>
          <input ref={fileInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void selectAvatar(event)} />
          <div className="profile-fields">
            <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={2} maxLength={32} required /></label>
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} placeholder="you@example.com" /></label>
            <label className="profile-description">About me<textarea aria-label="About me" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={190} rows={4} placeholder="A few words about you…" /><small>{description.length}/190</small></label>
            <div className="profile-avatar-actions">
              <button type="button" onClick={() => fileInputRef.current?.click()}>Upload picture</button>
              {avatarUrl ? <button type="button" className="danger-link" onClick={() => setAvatarUrl(null)}>Remove</button> : null}
              <small>PNG, JPEG, WebP or GIF · 512 KB max</small>
            </div>
          </div>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <footer className="profile-actions">
            <button type="button" className="profile-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="profile-save" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
