export const CAPABILITIES = ["manage_channels", "manage_server", "moderate", "publish_voice"] as const;
export type Capability = (typeof CAPABILITIES)[number];

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
export type AdminUser = CurrentUser & { createdAt: string; bannedAt: string | null; voiceMuted: boolean };
export type ChatSettings = { maxImageSizeMb: number; maxFileSizeMb: number; maxMessageLength: number };
export type ServerSettings = ChatSettings & { registrationOpen: boolean };

export type Message = {
  id: string;
  channelId: string;
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

export type VoiceToken = { token: string; url: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...(hasBody && !isFormData ? { "content-type": "application/json" } : {}), ...init?.headers },
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

export function getSetupStatus(): Promise<{ done: boolean }> {
  return request("/api/setup");
}
export function getRegistrationStatus(): Promise<Pick<ServerSettings, "registrationOpen">> { return request("/api/registration-status"); }

export function setup(username: string, password: string): Promise<{ ok: true }> {
  return request("/api/setup", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function login(username: string, password: string): Promise<{ ok: true }> {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function register(username: string, password: string, inviteToken?: string): Promise<{ ok: true }> {
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
export function listAdminUsers(): Promise<AdminUser[]> { return request("/api/admin/users"); }
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

export function listMessages(channelId: string, opts?: { before?: string; limit?: number }): Promise<Message[]> {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request(`/api/channels/${channelId}/messages${qs ? `?${qs}` : ""}`);
}

export function postMessage(channelId: string, content: string, files: File[] = [], replyToMessageId?: string): Promise<Message> {
  if (files.length === 0) return request(`/api/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content, replyToMessageId }) });
  const body = new FormData();
  body.set("content", content);
  if (replyToMessageId) body.set("replyToMessageId", replyToMessageId);
  for (const file of files) body.append("files", file, file.name);
  return request(`/api/channels/${channelId}/messages`, { method: "POST", body });
}

export function updateMessage(channelId: string, messageId: string, content: string): Promise<Message> {
  return request(`/api/channels/${channelId}/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ content }) });
}
export function deleteMessage(channelId: string, messageId: string): Promise<void> {
  return request(`/api/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
}
export function addMessageReaction(channelId: string, messageId: string, emoji: string): Promise<Message> {
  return request(`/api/channels/${channelId}/messages/${messageId}/reactions`, { method: "PUT", body: JSON.stringify({ emoji }) });
}
export function removeMessageReaction(channelId: string, messageId: string, emoji: string): Promise<Message> {
  return request(`/api/channels/${channelId}/messages/${messageId}/reactions`, { method: "DELETE", body: JSON.stringify({ emoji }) });
}

export function getVoiceToken(channelId: string): Promise<VoiceToken> {
  return request(`/api/channels/${channelId}/voice-token`, { method: "POST" });
}
