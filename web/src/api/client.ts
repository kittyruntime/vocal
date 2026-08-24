export const CAPABILITIES = ["manage_channels", "manage_server", "moderate", "publish_voice"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const SOUND_EVENTS = ["message", "userJoin", "userLeave", "muteToggle", "forceMuted", "screenShare"] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];
export type SoundSetting = { enabled: boolean; hasCustom: boolean };
export type SoundSettings = Record<SoundEvent, SoundSetting>;
export type SoundVolumes = Record<SoundEvent, number>;
export type UserSoundSettings = Record<SoundEvent, { hasCustom: boolean }>;

export type CurrentUser = {
  id: string;
  username: string;
  email?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  description?: string;
  capabilities: Capability[];
};
export type ProfileUpdate = Pick<Required<CurrentUser>, "username" | "email" | "avatarUrl" | "bannerUrl" | "description">;
export type PublicProfile = { id: string; username: string; description: string; avatarUrl: string | null; bannerUrl: string | null };

export type Channel = {
  id: string;
  name: string;
  type: "text" | "voice";
  requiredCapability: Capability | null;
  position: number;
  createdAt: string;
  defaultAudioQuality?: "low" | "standard" | "high";
  defaultCameraQuality?: "low" | "standard" | "high";
  defaultScreenQuality?: "low" | "standard" | "high" | "game";
};
export type Role = { id: string; name: string; color: string; position: number; capabilities: Capability[]; memberCount: number };
export type AdminUser = CurrentUser & { createdAt: string; bannedAt: string | null; voiceMuted: boolean; roles?: Pick<Role, "id" | "name" | "color">[] };
export type ChatSettings = { maxImageSizeMb: number; maxFileSizeMb: number; maxMessageLength: number };
export type ServerSettings = ChatSettings & { registrationOpen: boolean };

export type Message = {
  id: string;
  channelId?: string;
  conversationId?: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  replyTo?: { id: string; userId: string; username: string; content: string } | null;
  reactions?: { emoji: string; count: number; userIds: string[] }[];
  attachments?: MessageAttachment[];
};
export type MessageAttachment = { id: string; filename: string; mimeType: string; size: number; url: string };
export type SearchResults = {
  channels: { id: string; name: string; type: Channel["type"] }[];
  members: { id: string; username: string; avatarUrl: string | null }[];
  messages: { id: string; channelId: string; channelName: string; username: string; content: string; filenames: string[]; createdAt: string }[];
};
export type Invite = { id: string; token?: string; expiresAt: string; maxUses: number; useCount: number; createdAt?: string; revokedAt?: string | null };

export type ConversationParticipant = { userId: string; username: string; avatarUrl: string | null };
export type Conversation = { id: string; type: "dm" | "group"; name: string | null; participants: ConversationParticipant[]; createdAt: string };

// Identifies where a message lives: exactly one of channelId/conversationId.
export type MessageTarget = { channelId: string; conversationId?: undefined } | { channelId?: undefined; conversationId: string };

export type VoiceToken = { token: string; url: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Non-null only for the desktop app, which points at an arbitrary self-hosted
// server (cross-origin) and authenticates over this Bearer token instead of
// the same-origin cookie the web client uses by default.
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}

// Points every relative request (fetch paths below, but also plain <img>/<a>
// URLs the app renders for avatars/attachments, which it never prefixes
// manually) at a remote server instead of the page's own origin. No-op
// (removes the tag) for the normal same-origin web deployment.
export function setServerBase(url: string | null): void {
  const existing = document.querySelector("base[data-vocal-server]");
  if (!url) {
    existing?.remove();
    return;
  }
  const base = existing ?? document.createElement("base");
  base.setAttribute("data-vocal-server", "");
  base.setAttribute("href", url.endsWith("/") ? url : `${url}/`);
  if (!existing) document.head.prepend(base);
}

export function getServerBase(): string | null {
  return document.querySelector("base[data-vocal-server]")?.getAttribute("href") ?? null;
}

// Tries `url` as a server base, confirming it's actually a vocal server via
// /api/health before committing. Reverts on failure so a bad URL never
// leaves the app pointed somewhere broken.
export async function connectToServer(url: string): Promise<boolean> {
  const previous = document.querySelector("base[data-vocal-server]")?.getAttribute("href") ?? null;
  setServerBase(url);
  try {
    await request("/api/health");
    return true;
  } catch {
    setServerBase(previous);
    return false;
  }
}

// The long-lived session token must never end up in a URL (proxy/access
// logs). Token-authenticated (desktop) connections instead exchange it for a
// single-use, 30-second ticket right before opening the socket.
export async function getWsUrl(): Promise<string> {
  const url = new URL("/ws", document.baseURI);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (authToken) {
    const { ticket } = await request<{ ticket: string }>("/api/ws-ticket", { method: "POST" });
    url.searchParams.set("ticket", ticket);
  }
  return url.toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    // Cross-origin (a server base is configured, i.e. the desktop app) never
    // sends credentials, even before a token exists yet -- e.g. the very
    // first /api/health check in connectToServer, pre-auth. The server's
    // CORS policy for /api/* only allows non-credentialed requests; asking
    // for "include" here would make the browser require
    // Access-Control-Allow-Credentials and fail the request outright.
    credentials: getServerBase() ? "omit" : "include",
    headers: {
      ...(hasBody && !isFormData ? { "content-type": "application/json" } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const res = await fetch(path, {
    ...init,
    // Cross-origin (a server base is configured, i.e. the desktop app) never
    // sends credentials, even before a token exists yet -- e.g. the very
    // first /api/health check in connectToServer, pre-auth. The server's
    // CORS policy for /api/* only allows non-credentialed requests; asking
    // for "include" here would make the browser require
    // Access-Control-Allow-Credentials and fail the request outright.
    credentials: getServerBase() ? "omit" : "include",
    headers: { ...(authToken ? { authorization: `Bearer ${authToken}` } : {}), ...init?.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, text || `request failed (${res.status})`);
  return text;
}

export function getSetupStatus(): Promise<{ done: boolean }> {
  return request("/api/setup");
}
export function getRegistrationStatus(): Promise<Pick<ServerSettings, "registrationOpen">> { return request("/api/registration-status"); }

// `token` is only meaningful to the desktop app (see setAuthToken above) --
// the web client authenticates via the cookie these routes also set, and
// simply ignores the field.
export function setup(username: string, password: string): Promise<{ ok: true; token: string }> {
  return request("/api/setup", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function login(username: string, password: string): Promise<{ ok: true; token: string }> {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function register(username: string, password: string, inviteToken?: string): Promise<{ ok: true; token: string }> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, ...(inviteToken ? { inviteToken } : {}) }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request("/api/auth/logout", { method: "POST" });
}

export function getMe(): Promise<CurrentUser> {
  return request("/api/me");
}

export function updateProfile(profile: ProfileUpdate): Promise<CurrentUser> {
  return request("/api/me", { method: "PATCH", body: JSON.stringify(profile) });
}
export function getPublicProfile(userId: string): Promise<PublicProfile> { return request(`/api/users/${userId}/profile`); }
export function search(query: string): Promise<SearchResults> { return request(`/api/search?q=${encodeURIComponent(query)}`); }
export function listInvites(): Promise<Invite[]> { return request("/api/invites"); }
export function createInvite(settings: { expiresInHours: number; maxUses: number }): Promise<Invite> { return request("/api/invites", { method: "POST", body: JSON.stringify(settings) }); }
export function revokeInvite(inviteId: string): Promise<void> { return request(`/api/invites/${inviteId}`, { method: "DELETE" }); }

export function listChannels(): Promise<Channel[]> {
  return request("/api/channels");
}

export function createChannel(input: { name: string; type: "text" | "voice"; requiredCapability?: Capability | null }): Promise<Channel> {
  return request("/api/channels", { method: "POST", body: JSON.stringify(input) });
}

export function updateChannel(channelId: string, input: Partial<Pick<Channel, "name" | "requiredCapability" | "defaultAudioQuality" | "defaultCameraQuality" | "defaultScreenQuality">>): Promise<Channel> {
  return request(`/api/channels/${channelId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteChannel(channelId: string): Promise<void> {
  return request(`/api/channels/${channelId}`, { method: "DELETE" });
}

export function getAdminSettings(): Promise<ServerSettings> { return request("/api/admin/settings"); }
export function getChatSettings(): Promise<ChatSettings> { return request("/api/chat-settings"); }
export function updateAdminSettings(settings: ServerSettings): Promise<ServerSettings> {
  return request("/api/admin/settings", { method: "PATCH", body: JSON.stringify(settings) });
}
export function getSoundSettings(): Promise<SoundSettings> { return request("/api/sounds"); }
export function updateSoundSetting(event: SoundEvent, patch: { enabled?: boolean; audioData?: string | null }): Promise<SoundSetting> {
  return request(`/api/admin/sounds/${event}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function getMySoundVolumes(): Promise<SoundVolumes> { return request("/api/me/sound-volumes"); }
export function updateMySoundVolume(event: SoundEvent, volume: number): Promise<SoundVolumes> {
  return request("/api/me/sound-volumes", { method: "PATCH", body: JSON.stringify({ event, volume }) });
}
export function getMySoundSettings(): Promise<UserSoundSettings> { return request("/api/me/sounds"); }
export function updateMySoundSetting(event: SoundEvent, audioData: string | null): Promise<{ hasCustom: boolean }> {
  return request(`/api/me/sounds/${event}`, { method: "PATCH", body: JSON.stringify({ audioData }) });
}
export function listAdminUsers(opts?: { search?: string; page?: number; limit?: number }): Promise<{ users: AdminUser[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.search) params.set("search", opts.search);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request(`/api/admin/users${qs ? `?${qs}` : ""}`);
}
export function listRoles(): Promise<Role[]> { return request("/api/admin/roles"); }
export function createRole(input: Pick<Role, "name" | "color" | "capabilities">): Promise<Role> { return request("/api/admin/roles", { method: "POST", body: JSON.stringify(input) }); }
export function updateRole(roleId: string, input: Pick<Role, "name" | "color" | "capabilities">): Promise<Role> { return request(`/api/admin/roles/${roleId}`, { method: "PATCH", body: JSON.stringify(input) }); }
export function deleteRole(roleId: string): Promise<void> { return request(`/api/admin/roles/${roleId}`, { method: "DELETE" }); }
export function setUserRoles(userId: string, roleIds: string[]): Promise<AdminUser> { return request(`/api/admin/users/${userId}/roles`, { method: "PUT", body: JSON.stringify({ roleIds }) }); }
export function updateUserCapabilities(userId: string, capabilities: Capability[]): Promise<AdminUser> {
  return request(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ capabilities }) });
}
export function kickUser(userId: string): Promise<{ ok: true }> {
  return request(`/api/admin/users/${userId}/kick`, { method: "POST" });
}
export function banUser(userId: string): Promise<AdminUser> {
  return request(`/api/admin/users/${userId}/ban`, { method: "POST" });
}
export function unbanUser(userId: string): Promise<AdminUser> {
  return request(`/api/admin/users/${userId}/unban`, { method: "POST" });
}
export function setUserVoiceMuted(userId: string, muted: boolean): Promise<AdminUser> {
  return request(`/api/admin/users/${userId}/voice-mute`, { method: "PATCH", body: JSON.stringify({ muted }) });
}

function messagesBasePath(target: MessageTarget): string {
  return target.conversationId ? `/api/conversations/${target.conversationId}/messages` : `/api/channels/${target.channelId}/messages`;
}

export function listMessages(target: MessageTarget, opts?: { before?: string; limit?: number }): Promise<Message[]> {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request(`${messagesBasePath(target)}${qs ? `?${qs}` : ""}`);
}

export function postMessage(target: MessageTarget, content: string, files: File[] = [], replyToMessageId?: string): Promise<Message> {
  const base = messagesBasePath(target);
  if (files.length === 0) return request(base, { method: "POST", body: JSON.stringify({ content, replyToMessageId }) });
  const body = new FormData();
  body.set("content", content);
  if (replyToMessageId) body.set("replyToMessageId", replyToMessageId);
  for (const file of files) body.append("files", file, file.name);
  return request(base, { method: "POST", body });
}

export function updateMessage(target: MessageTarget, messageId: string, content: string): Promise<Message> {
  return request(`${messagesBasePath(target)}/${messageId}`, { method: "PATCH", body: JSON.stringify({ content }) });
}
export function deleteMessage(target: MessageTarget, messageId: string): Promise<void> {
  return request(`${messagesBasePath(target)}/${messageId}`, { method: "DELETE" });
}
export function addMessageReaction(target: MessageTarget, messageId: string, emoji: string): Promise<Message> {
  return request(`${messagesBasePath(target)}/${messageId}/reactions`, { method: "PUT", body: JSON.stringify({ emoji }) });
}
export function removeMessageReaction(target: MessageTarget, messageId: string, emoji: string): Promise<Message> {
  return request(`${messagesBasePath(target)}/${messageId}/reactions`, { method: "DELETE", body: JSON.stringify({ emoji }) });
}

export function listConversations(): Promise<Conversation[]> { return request("/api/conversations"); }
export function createDirectMessage(userId: string): Promise<Conversation> {
  return request("/api/conversations", { method: "POST", body: JSON.stringify({ type: "dm", userId }) });
}
export function createGroupConversation(participantIds: string[], name?: string): Promise<Conversation> {
  return request("/api/conversations", { method: "POST", body: JSON.stringify({ type: "group", participantIds, name }) });
}
export function renameConversation(conversationId: string, name: string): Promise<Conversation> {
  return request(`/api/conversations/${conversationId}`, { method: "PATCH", body: JSON.stringify({ name }) });
}
export function addConversationParticipant(conversationId: string, userId: string): Promise<Conversation> {
  return request(`/api/conversations/${conversationId}/participants`, { method: "POST", body: JSON.stringify({ userId }) });
}
export function removeConversationParticipant(conversationId: string, userId: string): Promise<void> {
  return request(`/api/conversations/${conversationId}/participants/${userId}`, { method: "DELETE" });
}

export function getVoiceToken(channelId: string): Promise<VoiceToken> {
  return request(`/api/channels/${channelId}/voice-token`, { method: "POST" });
}

export const ACCENT_PRESETS = ["amber", "ember-red", "magenta", "glacier", "emerald"] as const;
export type AccentPreset = (typeof ACCENT_PRESETS)[number];
export type AppearanceSettings = { enabledPresets: AccentPreset[]; defaultPreset: AccentPreset };

export function getAppearance(): Promise<AppearanceSettings> { return request("/api/appearance"); }
export function updateAppearance(patch: { enabledPresets?: AccentPreset[]; defaultPreset?: AccentPreset }): Promise<AppearanceSettings> {
  return request("/api/admin/appearance", { method: "PATCH", body: JSON.stringify(patch) });
}
export function getMyAccent(): Promise<{ accentPreset: AccentPreset | null }> { return request("/api/me/accent"); }
export function updateMyAccent(accentPreset: AccentPreset | null): Promise<{ accentPreset: AccentPreset | null }> {
  return request("/api/me/accent", { method: "PATCH", body: JSON.stringify({ accentPreset }) });
}

export type VersionInfo = { version: string; build: string };
export function getVersion(): Promise<VersionInfo> { return request("/api/version"); }
export function getChangelog(): Promise<string> { return requestText("/api/changelog"); }
