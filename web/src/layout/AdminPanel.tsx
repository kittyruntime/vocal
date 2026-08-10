import { useEffect, useState } from "react";
import type { AdminUser, Channel, CurrentUser, Role, ServerSettings } from "../api/client";
import * as api from "../api/client";
import { Icon } from "../ui/Icon";

export function AdminPanel({ channels, currentUser, onChannelUpdated, onChannelDeleted, onClose }: {
  channels: Channel[];
  currentUser: CurrentUser;
  onChannelUpdated(channel: Channel): void;
  onChannelDeleted(channelId: string): void;
  onClose(): void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<ServerSettings>({ registrationOpen: true });
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([api.listAdminUsers(), api.getAdminSettings()])
      .then(([nextUsers, nextSettings]) => { setUsers(nextUsers); setSettings(nextSettings); })
      .catch(() => setError("Impossible de charger les paramètres serveur."));
  }, []);

  async function changeRole(userId: string, role: Role) {
    try {
      const updated = await api.updateUserRole(userId, role);
      setUsers((value) => value.map((user) => user.id === userId ? updated : user));
    } catch (reason) {
      setError(reason instanceof api.ApiError && reason.message === "cannot demote the last admin" ? "Le serveur doit conserver au moins un administrateur." : "Impossible de modifier ce rôle.");
    }
  }

  async function kick(username: string, userId: string) {
    if (!window.confirm(`Expulser ${username} ? Ses sessions actives seront déconnectées ; iel pourra se reconnecter.`)) return;
    try {
      await api.kickUser(userId);
    } catch {
      setError("Impossible d’expulser cet utilisateur.");
    }
  }

  async function toggleBan(user: AdminUser) {
    if (!user.bannedAt && !window.confirm(`Bannir ${user.username} ? Iel sera déconnecté·e et ne pourra plus se reconnecter tant que le bannissement n’est pas levé.`)) return;
    try {
      const updated = user.bannedAt ? await api.unbanUser(user.id) : await api.banUser(user.id);
      setUsers((value) => value.map((value_) => value_.id === user.id ? updated : value_));
    } catch (reason) {
      setError(reason instanceof api.ApiError && reason.message === "cannot ban yourself" ? "Tu ne peux pas te bannir toi-même." : "Impossible de modifier le statut de bannissement.");
    }
  }

  async function toggleRegistration() {
    try {
      setSettings(await api.updateAdminSettings({ registrationOpen: !settings.registrationOpen }));
    } catch { setError("Impossible de modifier les inscriptions."); }
  }

  return (
    <div className="voice-modal-backdrop admin-backdrop" role="presentation">
      <section className="voice-settings-modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <header><div><span>ADMINISTRATION</span><h2 id="admin-title">Paramètres du serveur</h2></div><button type="button" className="modal-close" aria-label="Fermer l’administration" onClick={onClose}><Icon name="close" size={20} /></button></header>
        <div className="voice-settings-content">
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <div className="settings-section admin-setting-row">
            <div><h3>Inscriptions publiques</h3><p>Les invitations restent utilisables lorsque les inscriptions sont fermées.</p></div>
            <button type="button" className={`setting-switch ${settings.registrationOpen ? "active" : ""}`} aria-pressed={settings.registrationOpen} onClick={() => void toggleRegistration()}>{settings.registrationOpen ? "Ouvertes" : "Fermées"}</button>
          </div>
          <div className="settings-section"><h3>Membres et rôles</h3><div className="admin-user-list">{users.map((user) => <div className={`admin-user ${user.bannedAt ? "is-banned" : ""}`} key={user.id}><span className="member-avatar">{user.username[0].toUpperCase()}</span><strong>{user.username}{user.id === currentUser.id ? " (vous)" : ""}{user.bannedAt ? <span className="ban-badge">Banni</span> : null}</strong><select aria-label={`Rôle de ${user.username}`} value={user.role} onChange={(event) => void changeRole(user.id, event.target.value as Role)}><option value="member">Membre</option><option value="moderator">Modérateur</option><option value="admin">Administrateur</option></select>{user.id === currentUser.id ? null : <div className="admin-user-actions"><button type="button" className="danger-link" onClick={() => void kick(user.username, user.id)}>Expulser</button><button type="button" className={user.bannedAt ? "" : "danger-link"} onClick={() => void toggleBan(user)}>{user.bannedAt ? "Débannir" : "Bannir"}</button></div>}</div>)}</div></div>
          <div className="settings-section"><h3>Salons</h3><div className="admin-channel-list">{channels.map((channel) => <ChannelSettings key={channel.id} channel={channel} onUpdated={onChannelUpdated} onDeleted={onChannelDeleted} />)}</div></div>
        </div>
      </section>
    </div>
  );
}

function ChannelSettings({ channel, onUpdated, onDeleted }: { channel: Channel; onUpdated(channel: Channel): void; onDeleted(id: string): void }) {
  const [draft, setDraft] = useState(channel);
  const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); try { const value = await api.updateChannel(channel.id, draft); onUpdated(value); } finally { setBusy(false); } }
  async function remove() { if (!window.confirm(`Supprimer le salon « ${channel.name} » ?`)) return; setBusy(true); try { await api.deleteChannel(channel.id); onDeleted(channel.id); } finally { setBusy(false); } }
  return <article className="admin-channel"><div className="admin-channel-head"><input aria-label={`Nom de ${channel.name}`} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><select aria-label={`Accès à ${channel.name}`} value={draft.minRole} onChange={(event) => setDraft({ ...draft, minRole: event.target.value as Role })}><option value="member">Tous les membres</option><option value="moderator">Modérateurs</option><option value="admin">Administrateurs</option></select></div>{channel.type === "voice" ? <div className="admin-quality-row"><Quality label="Audio" value={draft.defaultAudioQuality ?? "standard"} onChange={(value) => setDraft({ ...draft, defaultAudioQuality: value as Channel["defaultAudioQuality"] })} /><Quality label="Webcam" value={draft.defaultCameraQuality ?? "standard"} onChange={(value) => setDraft({ ...draft, defaultCameraQuality: value as Channel["defaultCameraQuality"] })} /><Quality label="Partage" game value={draft.defaultScreenQuality ?? "standard"} onChange={(value) => setDraft({ ...draft, defaultScreenQuality: value as Channel["defaultScreenQuality"] })} /></div> : null}<div className="admin-channel-actions"><button type="button" disabled={busy} onClick={() => void save()}>Enregistrer</button><button type="button" className="danger-link" disabled={busy} onClick={() => void remove()}>Supprimer</button></div></article>;
}

function Quality({ label, value, game, onChange }: { label: string; value: string; game?: boolean; onChange(value: string): void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="low">Économie</option><option value="standard">Équilibrée</option><option value="high">Haute</option>{game ? <option value="game">Jeu 1080p60</option> : null}</select></label>;
}
