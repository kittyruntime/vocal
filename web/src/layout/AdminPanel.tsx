import { useEffect, useState } from "react";
import type { AdminUser, Capability, CurrentUser, ServerSettings } from "../api/client";
import { CAPABILITIES } from "../api/client";
import * as api from "../api/client";
import { Icon } from "../ui/Icon";

const CAPABILITY_LABEL: Record<Capability, string> = {
  manage_channels: "Manage channels",
  manage_server: "Manage server",
  moderate: "Moderate",
  publish_voice: "Publish in voice",
};

export function AdminPanel({ currentUser, onClose }: {
  currentUser: CurrentUser;
  onClose(): void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<ServerSettings>({ registrationOpen: true, maxImageSizeMb: 5, maxFileSizeMb: 10 });
  const [error, setError] = useState("");
  const canManageServer = currentUser.capabilities.includes("manage_server");
  const canModerate = currentUser.capabilities.includes("moderate");

  useEffect(() => {
    void Promise.all([api.listAdminUsers(), canManageServer ? api.getAdminSettings() : Promise.resolve(null)])
      .then(([nextUsers, nextSettings]) => { setUsers(nextUsers); if (nextSettings) setSettings(nextSettings); })
      .catch(() => setError("Could not load server settings."));
  }, [canManageServer]);

  async function toggleCapability(user: AdminUser, capability: Capability) {
    const capabilities = user.capabilities.includes(capability)
      ? user.capabilities.filter((value) => value !== capability)
      : [...user.capabilities, capability];
    try {
      const updated = await api.updateUserCapabilities(user.id, capabilities);
      setUsers((value) => value.map((entry) => entry.id === user.id ? updated : entry));
    } catch (reason) {
      setError(reason instanceof api.ApiError && reason.message === "cannot remove manage_server from the last holder" ? "The server must keep at least one member who can manage the server." : "Could not change this user's capabilities.");
    }
  }

  async function kick(username: string, userId: string) {
    if (!window.confirm(`Kick ${username}? Their active sessions will be disconnected; they can reconnect.`)) return;
    try {
      await api.kickUser(userId);
    } catch {
      setError("Could not kick this user.");
    }
  }

  async function toggleBan(user: AdminUser) {
    if (!user.bannedAt && !window.confirm(`Ban ${user.username}? They will be disconnected and unable to reconnect until the ban is lifted.`)) return;
    try {
      const updated = user.bannedAt ? await api.unbanUser(user.id) : await api.banUser(user.id);
      setUsers((value) => value.map((value_) => value_.id === user.id ? updated : value_));
    } catch (reason) {
      setError(reason instanceof api.ApiError && reason.message === "cannot ban yourself" ? "You cannot ban yourself." : "Could not change the ban status.");
    }
  }

  async function toggleRegistration() {
    try {
      setSettings(await api.updateAdminSettings({ ...settings, registrationOpen: !settings.registrationOpen }));
    } catch { setError("Could not change registration settings."); }
  }

  async function saveUploadLimits(next: ServerSettings) {
    try { setSettings(await api.updateAdminSettings(next)); }
    catch { setError("Could not change attachment limits."); }
  }

  async function toggleVoiceMute(user: AdminUser) {
    try {
      const updated = await api.setUserVoiceMuted(user.id, !user.voiceMuted);
      setUsers((value) => value.map((entry) => entry.id === user.id ? updated : entry));
    } catch (reason) {
      setError(reason instanceof api.ApiError && reason.message === "cannot voice-mute yourself" ? "You cannot force-mute yourself." : "Could not change this user's voice mute.");
    }
  }

  return (
    <div className="voice-modal-backdrop admin-backdrop" role="presentation">
      <section className="voice-settings-modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <header><div><span>ADMINISTRATION</span><h2 id="admin-title">Server settings</h2></div><button type="button" className="modal-close" aria-label="Close administration" onClick={onClose}><Icon name="close" size={20} /></button></header>
        <div className="voice-settings-content">
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          {canManageServer ? <div className="settings-section admin-setting-row">
            <div><h3>Public registration</h3><p>Invitations remain usable even when registration is closed.</p></div>
            <button type="button" className={`setting-switch ${settings.registrationOpen ? "active" : ""}`} aria-pressed={settings.registrationOpen} onClick={() => void toggleRegistration()}>{settings.registrationOpen ? "Open" : "Closed"}</button>
          </div> : null}
          {canManageServer ? <div className="settings-section">
            <h3>Attachment limits</h3>
            <p className="admin-setting-description">Maximum size accepted for each uploaded item. The hard server limit is 50 MB.</p>
            <div className="attachment-limit-grid">
              <label>Images (MB)<input type="number" min="1" max="50" value={settings.maxImageSizeMb} onChange={(event) => setSettings({ ...settings, maxImageSizeMb: Number(event.target.value) })} onBlur={() => void saveUploadLimits(settings)} /></label>
              <label>Other files (MB)<input type="number" min="1" max="50" value={settings.maxFileSizeMb} onChange={(event) => setSettings({ ...settings, maxFileSizeMb: Number(event.target.value) })} onBlur={() => void saveUploadLimits(settings)} /></label>
            </div>
          </div> : null}
          <div className="settings-section">
            <h3>Members and capabilities</h3>
            <div className="admin-user-list">
              {users.map((user) => (
                <div className={`admin-user ${user.bannedAt ? "is-banned" : ""}`} key={user.id}>
                  <span className="member-avatar">{user.username[0].toUpperCase()}</span>
                  <strong>{user.username}{user.id === currentUser.id ? " (you)" : ""}{user.bannedAt ? <span className="ban-badge">Banned</span> : null}{user.voiceMuted ? <span className="mute-badge">Voice muted</span> : null}</strong>
                  <div className="admin-user-capabilities">
                    {canManageServer ? CAPABILITIES.map((capability) => (
                      <label key={capability}>
                        <input
                          type="checkbox"
                          checked={user.capabilities.includes(capability)}
                          onChange={() => void toggleCapability(user, capability)}
                        />
                        {CAPABILITY_LABEL[capability]}
                      </label>
                    )) : <span className="admin-capability-summary">{user.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join(" · ") || "No capabilities"}</span>}
                  </div>
                  {user.id === currentUser.id ? null : (
                    <div className="admin-user-actions">
                      {canModerate ? <><button type="button" className={user.voiceMuted ? "" : "danger-link"} onClick={() => void toggleVoiceMute(user)}>{user.voiceMuted ? "Allow voice" : "Force mute"}</button><button type="button" className="danger-link" onClick={() => void kick(user.username, user.id)}>Kick</button><button type="button" className={user.bannedAt ? "" : "danger-link"} onClick={() => void toggleBan(user)}>{user.bannedAt ? "Unban" : "Ban"}</button></> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="admin-hint">Channel name, access, and quality settings have moved to the <Icon name="settings" size={13} /> icon next to each channel in the sidebar.</p>
        </div>
      </section>
    </div>
  );
}
