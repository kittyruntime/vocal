import { useEffect, useState } from "react";
import type { PublicProfile } from "../api/client";
import * as api from "../api/client";
import { Icon } from "../ui/Icon";

export function UserProfileModal({ userId, onClose }: { userId: string; onClose(): void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.getPublicProfile(userId).then(setProfile).catch(() => setError("This profile could not be loaded."));
  }, [userId]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return <div className="voice-modal-backdrop public-profile-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="public-profile-modal" role="dialog" aria-modal="true" aria-label={profile ? `Profile of ${profile.username}` : "User profile"}>
      <button type="button" className="modal-close public-profile-close" aria-label="Close user profile" onClick={onClose}><Icon name="close" size={18} /></button>
      {error ? <p className="admin-error" role="alert">{error}</p> : profile ? <>
        <div className="public-profile-banner" style={profile.bannerUrl ? { backgroundImage: `url(${profile.bannerUrl})` } : undefined} />
        <div className="public-profile-body">
          <span className="public-profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.username.slice(0, 1).toUpperCase()}</span>
          <h2>{profile.username}</h2>
          <div className="public-profile-about"><strong>About me</strong><p>{profile.description || "No description yet."}</p></div>
        </div>
      </> : <div className="public-profile-loading">Loading profile…</div>}
    </section>
  </div>;
}
