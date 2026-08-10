import { useEffect, useState } from "react";
import type { AdminUser, CurrentUser, Role, ServerSettings } from "../api/client";
import * as api from "../api/client";
import { Icon } from "../ui/Icon";

export function AdminPanel({ currentUser, onClose }: {
  currentUser: CurrentUser;
  onClose(): void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<ServerSettings>({ registrationOpen: true });
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([api.listAdminUsers(), api.getAdminSettings()])
      .then(([nextUsers, nextSettings]) => { setUsers(nextUsers); setSettings(nextSettings); })
      .catch(() => setError("Could not load server settings."));
  }, []);

  async function changeRole(userId: string, role: Role) {
    try {
      const updated = await api.updateUserRole(userId, role);
      setUsers((value) => value.map((user) => user.id === userId ? updated : user));
    } catch (reason) {
      setError(reason instanceof api.ApiError && reason.message === "cannot demote the last admin" ? "The server must keep at least one administrator." : "Could not change this role.");
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
      setSettings(await api.updateAdminSettings({ registrationOpen: !settings.registrationOpen }));
    } catch { setError("Could not change registration settings."); }
  }

  return (
    <div className="voice-modal-backdrop admin-backdrop" role="presentation">
      <section className="voice-settings-modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <header><div><span>ADMINISTRATION</span><h2 id="admin-title">Server settings</h2></div><button type="button" className="modal-close" aria-label="Close administration" onClick={onClose}><Icon name="close" size={20} /></button></header>
        <div className="voice-settings-content">
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <div className="settings-section admin-setting-row">
            <div><h3>Public registration</h3><p>Invitations remain usable even when registration is closed.</p></div>
            <button type="button" className={`setting-switch ${settings.registrationOpen ? "active" : ""}`} aria-pressed={settings.registrationOpen} onClick={() => void toggleRegistration()}>{settings.registrationOpen ? "Open" : "Closed"}</button>
          </div>
          <div className="settings-section"><h3>Members and roles</h3><div className="admin-user-list">{users.map((user) => <div className={`admin-user ${user.bannedAt ? "is-banned" : ""}`} key={user.id}><span className="member-avatar">{user.username[0].toUpperCase()}</span><strong>{user.username}{user.id === currentUser.id ? " (you)" : ""}{user.bannedAt ? <span className="ban-badge">Banned</span> : null}</strong><select aria-label={`Role for ${user.username}`} value={user.role} onChange={(event) => void changeRole(user.id, event.target.value as Role)}><option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Administrator</option></select>{user.id === currentUser.id ? null : <div className="admin-user-actions"><button type="button" className="danger-link" onClick={() => void kick(user.username, user.id)}>Kick</button><button type="button" className={user.bannedAt ? "" : "danger-link"} onClick={() => void toggleBan(user)}>{user.bannedAt ? "Unban" : "Ban"}</button></div>}</div>)}</div></div>
          <p className="admin-hint">Channel name, access, and quality settings have moved to the <Icon name="settings" size={13} /> icon next to each channel in the sidebar.</p>
        </div>
      </section>
    </div>
  );
}
