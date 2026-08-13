import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AccentPreset, AdminUser, AppearanceSettings, Capability, CurrentUser, Invite, Role, ServerSettings, SoundEvent, SoundSettings } from "../api/client";
import { ACCENT_PRESETS, CAPABILITIES, SOUND_EVENTS } from "../api/client";
import * as api from "../api/client";
import { previewSound } from "../audio/sounds";
import { ACCENT_PRESET_LABELS, ACCENT_SWATCH_COLORS } from "../theme/accent";
import { Icon } from "../ui/Icon";
import { Checkbox, ColorField, Select, Switch, TextField } from "../ui/form";

const CAPABILITY_LABEL: Record<Capability, string> = {
  manage_channels: "Manage channels",
  manage_server: "Manage server",
  moderate: "Moderate",
  publish_voice: "Publish in voice",
};
const MEMBERS_PER_PAGE = 8;
const MAX_SOUND_BYTES = 5 * 1024 * 1024;
const SOUND_EVENT_LABEL: Record<SoundEvent, { title: string; description: string }> = {
  message: { title: "Message received", description: "Plays when a new message arrives in a channel you're not currently authoring." },
  userJoin: { title: "Voice join", description: "Plays when someone joins the voice channel you're in." },
  userLeave: { title: "Voice leave", description: "Plays when someone leaves the voice channel you're in." },
  muteToggle: { title: "Microphone mute/unmute", description: "Plays when a member mutes or unmutes their own microphone." },
  forceMuted: { title: "Force-muted by a moderator", description: "Plays for a member when a moderator revokes their voice permission." },
  screenShare: { title: "Screen sharing", description: "Plays when you start or stop sharing your screen." },
};

export function AdminPanel({ currentUser, onClose }: {
  currentUser: CurrentUser;
  onClose(): void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]);
  const [settings, setSettings] = useState<ServerSettings>({ registrationOpen: true, maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
  const [savingLimits, setSavingLimits] = useState(false);
  const [savingLength, setSavingLength] = useState(false);
  const [imageLimitDraft, setImageLimitDraft] = useState(settings.maxImageSizeMb);
  const [fileLimitDraft, setFileLimitDraft] = useState(settings.maxFileSizeMb);
  const [messageLengthDraft, setMessageLengthDraft] = useState(settings.maxMessageLength);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(() => Object.fromEntries(
    SOUND_EVENTS.map((event) => [event, { enabled: true, hasCustom: false }]),
  ) as SoundSettings);
  const [appearance, setAppearance] = useState<AppearanceSettings>({ enabledPresets: [...ACCENT_PRESETS], defaultPreset: "amber" });
  const [error, setError] = useState("");
  const canManageServer = currentUser.capabilities.includes("manage_server");
  const canModerate = currentUser.capabilities.includes("moderate");
  const [activeTab, setActiveTab] = useState<"members" | "general" | "sounds" | "roles" | "invites" | "appearance">(canManageServer ? "general" : "members");
  const [memberSearch, setMemberSearch] = useState("");
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const memberPageCount = Math.max(1, Math.ceil(totalUsers / MEMBERS_PER_PAGE));

  // Debounced so typing a search doesn't fire a request per keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedMemberSearch(memberSearch.trim()), 250);
    return () => clearTimeout(timeout);
  }, [memberSearch]);
  useEffect(() => { setMemberPage(1); }, [debouncedMemberSearch]);
  useEffect(() => { setMemberPage((page) => Math.min(page, memberPageCount)); }, [memberPageCount]);

  useEffect(() => {
    void Promise.all([
      canManageServer ? api.getAdminSettings() : Promise.resolve(null),
      canManageServer ? api.listRoles() : Promise.resolve([]),
      canManageServer ? api.getSoundSettings() : Promise.resolve(null),
      canManageServer ? api.getAppearance() : Promise.resolve(null),
    ])
      .then(([nextSettings, nextRoles, nextSoundSettings, nextAppearance]) => {
        setRoles(nextRoles);
        if (nextSettings) setSettings(nextSettings);
        if (nextSoundSettings) setSoundSettings(nextSoundSettings);
        if (nextAppearance) setAppearance(nextAppearance);
      })
      .catch(() => setError("Could not load server settings."));
  }, [canManageServer]);

  useEffect(() => { setImageLimitDraft(settings.maxImageSizeMb); }, [settings.maxImageSizeMb]);
  useEffect(() => { setFileLimitDraft(settings.maxFileSizeMb); }, [settings.maxFileSizeMb]);
  useEffect(() => { setMessageLengthDraft(settings.maxMessageLength); }, [settings.maxMessageLength]);

  useEffect(() => {
    void api.listAdminUsers({ search: debouncedMemberSearch || undefined, page: memberPage, limit: MEMBERS_PER_PAGE })
      .then(({ users: nextUsers, total }) => { setUsers(nextUsers); setTotalUsers(total); })
      .catch(() => setError("Could not load members."));
  }, [debouncedMemberSearch, memberPage]);

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

  async function saveAttachmentLimits(event: FormEvent) {
    event.preventDefault();
    setSavingLimits(true);
    setError("");
    try { setSettings(await api.updateAdminSettings({ ...settings, maxImageSizeMb: imageLimitDraft, maxFileSizeMb: fileLimitDraft })); }
    catch { setError("Could not change attachment limits."); }
    finally { setSavingLimits(false); }
  }

  async function saveMessageLength(event: FormEvent) {
    event.preventDefault();
    setSavingLength(true);
    setError("");
    try { setSettings(await api.updateAdminSettings({ ...settings, maxMessageLength: messageLengthDraft })); }
    catch { setError("Could not change the message length limit."); }
    finally { setSavingLength(false); }
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
          {canManageServer ? <button type="button" className={activeTab === "sounds" ? "active" : ""} aria-pressed={activeTab === "sounds"} onClick={() => setActiveTab("sounds")}><Icon name="volume" size={17} /> Sounds</button> : null}
          {canManageServer ? <button type="button" className={activeTab === "roles" ? "active" : ""} aria-pressed={activeTab === "roles"} onClick={() => setActiveTab("roles")}><Icon name="users" size={17} /> Roles <span className="settings-tab-count">{roles.length}</span></button> : null}
          {canManageServer ? <button type="button" className={activeTab === "invites" ? "active" : ""} aria-pressed={activeTab === "invites"} onClick={() => setActiveTab("invites")}><Icon name="plus" size={17} /> Invitations</button> : null}
          {canManageServer ? <button type="button" className={activeTab === "appearance" ? "active" : ""} aria-pressed={activeTab === "appearance"} onClick={() => setActiveTab("appearance")}><Icon name="settings" size={17} /> Appearance</button> : null}
          <button type="button" className={activeTab === "members" ? "active" : ""} aria-pressed={activeTab === "members"} onClick={() => setActiveTab("members")}><Icon name="users" size={17} /> Members <span className="settings-tab-count">{totalUsers}</span></button>
        </nav>
        <div className="voice-settings-content admin-settings-content">
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {activeTab === "general" && canManageServer ? <><div className="settings-section admin-setting-row">
            <div><h3>Public registration</h3><p>Invitations remain usable even when registration is closed.</p></div>
            <Switch label="Public registration" visuallyHiddenLabel checked={settings.registrationOpen} onChange={() => void toggleRegistration()} />
          </div>
          <form className="settings-section" onSubmit={saveAttachmentLimits}>
            <h3>Attachment limits</h3>
            <p className="admin-setting-description">Maximum size accepted for each uploaded item. The hard server limit is 50 MB.</p>
            <div className="attachment-limit-grid">
              <TextField label="Images (MB)" type="number" min="1" max="50" value={imageLimitDraft} onChange={(event) => setImageLimitDraft(Number(event.target.value))} />
              <TextField label="Other files (MB)" type="number" min="1" max="50" value={fileLimitDraft} onChange={(event) => setFileLimitDraft(Number(event.target.value))} />
            </div>
            <button type="submit" disabled={savingLimits}>{savingLimits ? "Saving…" : "Save changes"}</button>
          </form>
          <form className="settings-section" onSubmit={saveMessageLength}>
            <h3>Message length</h3>
            <p className="admin-setting-description">Maximum number of characters allowed in a single message.</p>
            <div className="attachment-limit-grid single-setting">
              <TextField label="Characters per message" type="number" min="100" max="10000" step="100" value={messageLengthDraft} onChange={(event) => setMessageLengthDraft(Number(event.target.value))} />
            </div>
            <button type="submit" disabled={savingLength}>{savingLength ? "Saving…" : "Save length"}</button>
          </form>
          <p className="admin-hint">Channel-specific access and voice quality remain under the <Icon name="settings" size={13} /> icon beside each channel.</p></> : null}
          {activeTab === "sounds" && canManageServer ? <SoundSettingsManager soundSettings={soundSettings} onChange={setSoundSettings} onError={setError} /> : null}
          {activeTab === "roles" && canManageServer ? <RoleManager roles={roles} onChange={setRoles} onError={setError} /> : null}
          {activeTab === "invites" && canManageServer ? <InviteManager onError={setError} /> : null}
          {activeTab === "appearance" && canManageServer ? <AppearanceManager appearance={appearance} onChange={setAppearance} onError={setError} /> : null}
          {activeTab === "members" ? <div className="settings-section admin-members-section">
            <div className="admin-members-heading">
              <div><h3>Members</h3><p>{totalUsers} {totalUsers === 1 ? "member" : "members"}</p></div>
              <TextField type="search" label="Search members" visuallyHiddenLabel placeholder="Search members" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} />
            </div>
            <div className="admin-user-list">
              {users.map((user) => (
                <div className={`admin-user ${user.bannedAt ? "is-banned" : ""}`} key={user.id}>
                  <span className="member-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.username[0].toUpperCase()}</span>
                  <strong>{user.username}{user.id === currentUser.id ? " (you)" : ""}{user.bannedAt ? <span className="ban-badge">Banned</span> : null}{user.voiceMuted ? <span className="mute-badge">Voice muted</span> : null}</strong>
                  <div className="admin-user-capabilities">
                    {canManageServer && roles.length > 0 ? (
                      <div className="admin-user-roles">
                        {roles.map((role) => (
                          <Checkbox
                            key={role.id}
                            label={<><i style={{ background: role.color }} />{role.name}</>}
                            checked={user.roles?.some((value) => value.id === role.id) ?? false}
                            onChange={() => void toggleUserRole(user, role)}
                          />
                        ))}
                      </div>
                    ) : null}
                    {canManageServer ? CAPABILITIES.map((capability) => (
                      <Checkbox
                        key={capability}
                        label={CAPABILITY_LABEL[capability]}
                        checked={user.capabilities.includes(capability)}
                        onChange={() => void toggleCapability(user, capability)}
                      />
                    )) : <span className="admin-capability-summary">{user.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join(" · ") || "No capabilities"}</span>}
                  </div>
                  {user.id === currentUser.id ? null : (
                    <div className="admin-user-actions">
                      {canModerate ? <><button type="button" className={user.voiceMuted ? "" : "danger-link"} onClick={() => void toggleVoiceMute(user)}>{user.voiceMuted ? "Allow voice" : "Force mute"}</button><button type="button" className="danger-link" onClick={() => void kick(user.username, user.id)}>Kick</button><button type="button" className={user.bannedAt ? "" : "danger-link"} onClick={() => void toggleBan(user)}>{user.bannedAt ? "Unban" : "Ban"}</button></> : null}
                    </div>
                  )}
                </div>
              ))}
              {users.length === 0 ? <p className="admin-members-empty">No member matches this search.</p> : null}
            </div>
            {memberPageCount > 1 ? <nav className="admin-pagination" aria-label="Members pagination"><button type="button" disabled={memberPage === 1} onClick={() => setMemberPage((page) => page - 1)}>Previous</button><span>Page {memberPage} of {memberPageCount}</span><button type="button" disabled={memberPage === memberPageCount} onClick={() => setMemberPage((page) => page + 1)}>Next</button></nav> : null}
          </div> : null}
        </div>
        </div>
      </section>
    </div>
  );
}

function InviteManager({ onError }: { onError(message: string): void }) {
  const [invites, setInvites] = useState<Invite[]>([]); const [expiresInHours, setExpiresInHours] = useState(168); const [maxUses, setMaxUses] = useState(1); const [createdUrl, setCreatedUrl] = useState("");
  useEffect(() => { void api.listInvites().then(setInvites).catch(() => onError("Could not load invitations.")); }, [onError]);
  async function create(event: FormEvent) { event.preventDefault(); try { const invite = await api.createInvite({ expiresInHours, maxUses }); setInvites((values) => [invite, ...values]); setCreatedUrl(`${window.location.origin}/?invite=${invite.token}`); } catch { onError("Could not create an invitation."); } }
  async function revoke(inviteId: string) { try { await api.revokeInvite(inviteId); setInvites((values) => values.filter((invite) => invite.id !== inviteId)); } catch { onError("Could not revoke this invitation."); } }
  return <div className="settings-section admin-invites-section"><div className="admin-roles-heading"><div><h3>Invitations</h3><p>Create limited links and revoke them whenever needed.</p></div></div><form className="invite-create-form" onSubmit={create}><Select label="Expires" value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))}><option value={1}>1 hour</option><option value={24}>1 day</option><option value={168}>7 days</option><option value={720}>30 days</option></Select><TextField label="Maximum uses" type="number" min={1} max={100} value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))} /><button type="submit">Create link</button></form>{createdUrl ? <div className="invite-created"><input aria-label="New invitation link" readOnly value={createdUrl} /><button type="button" onClick={() => void navigator.clipboard?.writeText(createdUrl)}>Copy</button></div> : null}<div className="invite-list">{invites.map((invite) => { const expired = new Date(invite.expiresAt).getTime() <= Date.now(); return <div key={invite.id}><span><strong>{expired ? "Expired" : `${invite.useCount}/${invite.maxUses} uses`}</strong><small>Expires {new Date(invite.expiresAt).toLocaleString()}</small></span><button type="button" onClick={() => void revoke(invite.id)}>Revoke</button></div>; })}{invites.length === 0 ? <p className="admin-members-empty">No active invitation.</p> : null}</div></div>;
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
  return (
    <div className="settings-section admin-roles-section">
      <div className="admin-roles-heading">
        <div><h3>Roles</h3><p>Group permissions and assign them to multiple members.</p></div>
        <button type="button" onClick={() => edit()}>New role</button>
      </div>
      <div className="admin-role-layout">
        <div className="admin-role-list">
          {roles.map((role) => (
            <button type="button" key={role.id} className={editingId === role.id ? "active" : ""} onClick={() => edit(role)}>
              <i style={{ background: role.color }} />
              <span><strong>{role.name}</strong><small>{role.memberCount} members</small></span>
            </button>
          ))}
        </div>
        <form className="admin-role-editor" onSubmit={save}>
          <TextField label="Role name" value={name} maxLength={32} placeholder="Community manager" onChange={(event) => setName(event.target.value)} />
          <ColorField label="Color" value={color} onChange={setColor} />
          <fieldset>
            <legend>Permissions</legend>
            {CAPABILITIES.map((capability) => (
              <Checkbox
                key={capability}
                label={CAPABILITY_LABEL[capability]}
                checked={capabilities.includes(capability)}
                onChange={() => setCapabilities((values) => values.includes(capability) ? values.filter((value) => value !== capability) : [...values, capability])}
              />
            ))}
          </fieldset>
          <div>
            <button type="submit" disabled={!name.trim()}>{editingId ? "Save role" : "Create role"}</button>
            {editingId ? <button type="button" className="danger-link" onClick={() => void remove(roles.find((role) => role.id === editingId)!)}>Delete</button> : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function AppearanceManager({ appearance, onChange, onError }: {
  appearance: AppearanceSettings;
  onChange(appearance: AppearanceSettings): void;
  onError(message: string): void;
}) {
  async function toggle(preset: AccentPreset) {
    const enabledPresets = appearance.enabledPresets.includes(preset)
      ? appearance.enabledPresets.filter((value) => value !== preset)
      : [...appearance.enabledPresets, preset];
    if (enabledPresets.length === 0) return onError("At least one accent preset must stay enabled.");
    if (preset === appearance.defaultPreset && appearance.enabledPresets.includes(preset)) {
      return onError("Set a different default before disabling the current default preset.");
    }
    try {
      const updated = await api.updateAppearance({ enabledPresets });
      onChange(updated);
    } catch { onError("Could not update the enabled presets."); }
  }

  async function setDefault(preset: AccentPreset) {
    try {
      const updated = await api.updateAppearance({ defaultPreset: preset });
      onChange(updated);
    } catch { onError("Could not update the default preset."); }
  }

  return (
    <div className="settings-section admin-appearance-section">
      <h3>Appearance</h3>
      <p className="admin-setting-description">Choose which accent colors members can pick from, and which one is the default.</p>
      <div className="accent-swatch-list">
        {ACCENT_PRESETS.map((preset) => (
          <div key={preset} className="admin-accent-row">
            <button
              type="button"
              aria-label={ACCENT_PRESET_LABELS[preset]}
              aria-pressed={appearance.enabledPresets.includes(preset)}
              className={`accent-swatch ${appearance.enabledPresets.includes(preset) ? "active" : ""}`}
              style={{ background: ACCENT_SWATCH_COLORS[preset] }}
              onClick={() => void toggle(preset)}
            />
            <button
              type="button"
              aria-label={`Set ${ACCENT_PRESET_LABELS[preset]} as default`}
              disabled={!appearance.enabledPresets.includes(preset) || appearance.defaultPreset === preset}
              onClick={() => void setDefault(preset)}
            >
              {appearance.defaultPreset === preset ? "Default" : "Set as default"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SoundSettingsManager({ soundSettings, onChange, onError }: {
  soundSettings: SoundSettings;
  onChange(settings: SoundSettings): void;
  onError(message: string): void;
}) {
  const fileInputRefs = useRef<Partial<Record<SoundEvent, HTMLInputElement | null>>>({});

  async function toggle(event: SoundEvent) {
    try {
      const updated = await api.updateSoundSetting(event, { enabled: !soundSettings[event].enabled });
      onChange({ ...soundSettings, [event]: updated });
    } catch { onError("Could not change this sound's status."); }
  }

  function upload(event: SoundEvent, file: File) {
    if (!/^audio\/(mpeg|ogg|wav|webm)$/.test(file.type)) return onError("Choose an MP3, OGG, WAV or WebM audio file.");
    if (file.size > MAX_SOUND_BYTES) return onError("The sound file must be smaller than 5 MB.");
    const reader = new FileReader();
    reader.onload = () => {
      const audioData = typeof reader.result === "string" ? reader.result : null;
      if (!audioData) return;
      void api.updateSoundSetting(event, { audioData })
        .then((updated) => onChange({ ...soundSettings, [event]: updated }))
        .catch(() => onError("Could not upload this sound."));
    };
    reader.onerror = () => onError("The sound file could not be read.");
    reader.readAsDataURL(file);
  }

  async function reset(event: SoundEvent) {
    try {
      const updated = await api.updateSoundSetting(event, { audioData: null });
      onChange({ ...soundSettings, [event]: updated });
    } catch { onError("Could not reset this sound."); }
  }

  return (
    <div className="settings-section admin-sounds-section">
      <h3>Sounds</h3>
      <p className="admin-setting-description">Enable, disable or replace the sounds played for every member of this server.</p>
      <div className="sound-settings-list">
        {SOUND_EVENTS.map((event) => {
          const setting = soundSettings[event];
          const label = SOUND_EVENT_LABEL[event];
          return (
            <div className="sound-setting-row" key={event}>
              <div><h4>{label.title}</h4><p>{label.description}</p></div>
              <div className="sound-setting-actions">
                <button type="button" aria-label={`Preview ${label.title}`} onClick={() => previewSound(event, setting.hasCustom)}><Icon name="volume" size={15} /></button>
                <Switch label={`${label.title} enabled`} visuallyHiddenLabel checked={setting.enabled} onChange={() => void toggle(event)} />
                <input
                  ref={(el) => { fileInputRefs.current[event] = el; }}
                  className="sr-only"
                  type="file"
                  accept="audio/mpeg,audio/ogg,audio/wav,audio/webm"
                  onChange={(evt) => {
                    const file = evt.target.files?.[0];
                    evt.target.value = "";
                    if (file) upload(event, file);
                  }}
                />
                <button type="button" onClick={() => fileInputRefs.current[event]?.click()}>Upload</button>
                {setting.hasCustom ? <button type="button" className="danger-link" onClick={() => void reset(event)}>Reset</button> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
