import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AdminUser, Capability, CurrentUser, Role, ServerSettings } from "../api/client";
import { CAPABILITIES } from "../api/client";
import * as api from "../api/client";
import { Icon } from "../ui/Icon";

const CAPABILITY_LABEL: Record<Capability, string> = {
  manage_channels: "Manage channels",
  manage_server: "Manage server",
  moderate: "Moderate",
  publish_voice: "Publish in voice",
};
const MEMBERS_PER_PAGE = 8;

export function AdminPanel({ currentUser, onClose }: {
  currentUser: CurrentUser;
  onClose(): void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [settings, setSettings] = useState<ServerSettings>({ registrationOpen: true, maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
  const [error, setError] = useState("");
  const canManageServer = currentUser.capabilities.includes("manage_server");
  const canModerate = currentUser.capabilities.includes("moderate");
  const [activeTab, setActiveTab] = useState<"members" | "general" | "roles">(canManageServer ? "general" : "members");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const filteredUsers = useMemo(() => {
    const search = memberSearch.trim().toLocaleLowerCase();
    return search ? users.filter((user) => user.username.toLocaleLowerCase().includes(search)) : users;
  }, [memberSearch, users]);
  const memberPageCount = Math.max(1, Math.ceil(filteredUsers.length / MEMBERS_PER_PAGE));
  const visibleUsers = filteredUsers.slice((memberPage - 1) * MEMBERS_PER_PAGE, memberPage * MEMBERS_PER_PAGE);

  useEffect(() => { setMemberPage(1); }, [memberSearch]);
  useEffect(() => { setMemberPage((page) => Math.min(page, memberPageCount)); }, [memberPageCount]);

  useEffect(() => {
    void Promise.all([api.listAdminUsers(), canManageServer ? api.getAdminSettings() : Promise.resolve(null), canManageServer ? api.listRoles() : Promise.resolve([])])
      .then(([nextUsers, nextSettings, nextRoles]) => { setUsers(nextUsers); setRoles(nextRoles); if (nextSettings) setSettings(nextSettings); })
      .catch(() => setError("Could not load server settings."));
  }, [canManageServer]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

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

  async function toggleUserRole(user: AdminUser, role: Role) {
    const roleIds = user.roles?.some((value) => value.id === role.id) ? user.roles.filter((value) => value.id !== role.id).map((value) => value.id) : [...(user.roles?.map((value) => value.id) ?? []), role.id];
    try {
      const updated = await api.setUserRoles(user.id, roleIds);
      setUsers((values) => values.map((value) => value.id === user.id ? { ...value, ...updated, roles: roles.filter((entry) => roleIds.includes(entry.id)).map(({ id, name, color }) => ({ id, name, color })) } : value));
    } catch { setError("Could not update this member's roles."); }
  }

  return (
    <div className="voice-modal-backdrop admin-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="voice-settings-modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <header><div><span>ADMINISTRATION</span><h2 id="admin-title">Server settings</h2></div><button type="button" className="modal-close" aria-label="Close administration" onClick={onClose}><Icon name="close" size={20} /></button></header>
        <div className="admin-settings-layout">
        <nav className="settings-tabs" aria-label="Server settings sections">
          {canManageServer ? <button type="button" className={activeTab === "general" ? "active" : ""} aria-pressed={activeTab === "general"} onClick={() => setActiveTab("general")}><Icon name="settings" size={17} /> General</button> : null}
          {canManageServer ? <button type="button" className={activeTab === "roles" ? "active" : ""} aria-pressed={activeTab === "roles"} onClick={() => setActiveTab("roles")}><Icon name="users" size={17} /> Roles <span className="settings-tab-count">{roles.length}</span></button> : null}
          <button type="button" className={activeTab === "members" ? "active" : ""} aria-pressed={activeTab === "members"} onClick={() => setActiveTab("members")}><Icon name="users" size={17} /> Members <span className="settings-tab-count">{users.length}</span></button>
        </nav>
        <div className="voice-settings-content admin-settings-content">
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          {activeTab === "general" && canManageServer ? <><div className="settings-section admin-setting-row">
            <div><h3>Public registration</h3><p>Invitations remain usable even when registration is closed.</p></div>
            <button type="button" className={`setting-switch ${settings.registrationOpen ? "active" : ""}`} aria-pressed={settings.registrationOpen} onClick={() => void toggleRegistration()}>{settings.registrationOpen ? "Open" : "Closed"}</button>
          </div>
          <div className="settings-section">
            <h3>Attachment limits</h3>
            <p className="admin-setting-description">Maximum size accepted for each uploaded item. The hard server limit is 50 MB.</p>
            <div className="attachment-limit-grid">
              <label>Images (MB)<input type="number" min="1" max="50" value={settings.maxImageSizeMb} onChange={(event) => setSettings({ ...settings, maxImageSizeMb: Number(event.target.value) })} onBlur={() => void saveUploadLimits(settings)} /></label>
              <label>Other files (MB)<input type="number" min="1" max="50" value={settings.maxFileSizeMb} onChange={(event) => setSettings({ ...settings, maxFileSizeMb: Number(event.target.value) })} onBlur={() => void saveUploadLimits(settings)} /></label>
            </div>
          </div>
          <div className="settings-section">
            <h3>Message length</h3>
            <p className="admin-setting-description">Maximum number of characters allowed in a single message.</p>
            <div className="attachment-limit-grid single-setting">
              <label>Characters per message<input type="number" min="100" max="10000" step="100" value={settings.maxMessageLength} onChange={(event) => setSettings({ ...settings, maxMessageLength: Number(event.target.value) })} onBlur={() => void saveUploadLimits(settings)} /></label>
            </div>
          </div>
          <p className="admin-hint">Channel-specific access and voice quality remain under the <Icon name="settings" size={13} /> icon beside each channel.</p></> : null}
          {activeTab === "roles" && canManageServer ? <RoleManager roles={roles} onChange={setRoles} onError={setError} /> : null}
          {activeTab === "members" ? <div className="settings-section admin-members-section">
            <div className="admin-members-heading"><div><h3>Members</h3><p>{filteredUsers.length} {filteredUsers.length === 1 ? "member" : "members"}</p></div><input type="search" aria-label="Search members" placeholder="Search members" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} /></div>
            <div className="admin-user-list">
              {visibleUsers.map((user) => (
                <div className={`admin-user ${user.bannedAt ? "is-banned" : ""}`} key={user.id}>
                  <span className="member-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.username[0].toUpperCase()}</span>
                  <strong>{user.username}{user.id === currentUser.id ? " (you)" : ""}{user.bannedAt ? <span className="ban-badge">Banned</span> : null}{user.voiceMuted ? <span className="mute-badge">Voice muted</span> : null}</strong>
                  <div className="admin-user-capabilities">
                    {canManageServer && roles.length > 0 ? <div className="admin-user-roles">{roles.map((role) => <label key={role.id}><input type="checkbox" checked={user.roles?.some((value) => value.id === role.id) ?? false} onChange={() => void toggleUserRole(user, role)} /><i style={{ background: role.color }} />{role.name}</label>)}</div> : null}
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
              {visibleUsers.length === 0 ? <p className="admin-members-empty">No member matches this search.</p> : null}
            </div>
            {memberPageCount > 1 ? <nav className="admin-pagination" aria-label="Members pagination"><button type="button" disabled={memberPage === 1} onClick={() => setMemberPage((page) => page - 1)}>Previous</button><span>Page {memberPage} of {memberPageCount}</span><button type="button" disabled={memberPage === memberPageCount} onClick={() => setMemberPage((page) => page + 1)}>Next</button></nav> : null}
          </div> : null}
        </div>
        </div>
      </section>
    </div>
  );
}

function RoleManager({ roles, onChange, onError }: { roles: Role[]; onChange(roles: Role[]): void; onError(message: string): void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5865f2");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  function edit(role?: Role) { setEditingId(role?.id ?? null); setName(role?.name ?? ""); setColor(role?.color ?? "#5865f2"); setCapabilities(role?.capabilities ?? []); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!name.trim()) return;
    try {
      const saved = editingId ? await api.updateRole(editingId, { name: name.trim(), color, capabilities }) : await api.createRole({ name: name.trim(), color, capabilities });
      onChange(editingId ? roles.map((role) => role.id === editingId ? saved : role) : [...roles, saved]); edit();
    } catch { onError("Could not save this role."); }
  }
  async function remove(role: Role) {
    if (!window.confirm(`Delete the ${role.name} role?`)) return;
    try { await api.deleteRole(role.id); onChange(roles.filter((value) => value.id !== role.id)); if (editingId === role.id) edit(); }
    catch { onError("Could not delete this role."); }
  }
  return <div className="settings-section admin-roles-section"><div className="admin-roles-heading"><div><h3>Roles</h3><p>Group permissions and assign them to multiple members.</p></div><button type="button" onClick={() => edit()}>New role</button></div><div className="admin-role-layout"><div className="admin-role-list">{roles.map((role) => <button type="button" key={role.id} className={editingId === role.id ? "active" : ""} onClick={() => edit(role)}><i style={{ background: role.color }} /><span><strong>{role.name}</strong><small>{role.memberCount} members</small></span></button>)}</div><form className="admin-role-editor" onSubmit={save}><label>Role name<input value={name} maxLength={32} placeholder="Community manager" onChange={(event) => setName(event.target.value)} /></label><label>Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><fieldset><legend>Permissions</legend>{CAPABILITIES.map((capability) => <label key={capability}><input type="checkbox" checked={capabilities.includes(capability)} onChange={() => setCapabilities((values) => values.includes(capability) ? values.filter((value) => value !== capability) : [...values, capability])} />{CAPABILITY_LABEL[capability]}</label>)}</fieldset><div><button type="submit" disabled={!name.trim()}>{editingId ? "Save role" : "Create role"}</button>{editingId ? <button type="button" className="danger-link" onClick={() => void remove(roles.find((role) => role.id === editingId)!)}>Delete</button> : null}</div></form></div></div>;
}
