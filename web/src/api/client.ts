export type Role = "admin" | "moderator" | "member";

export type CurrentUser = { id: string; username: string; role: Role };

export type Channel = {
  id: string;
  name: string;
  type: "text" | "voice";
  minRole: Role;
  position: number;
  createdAt: string;
};

export type Message = {
  id: string;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
};

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
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
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

export function setup(username: string, password: string): Promise<{ ok: true }> {
  return request("/api/setup", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function login(username: string, password: string): Promise<{ ok: true }> {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function register(inviteToken: string, username: string, password: string): Promise<{ ok: true }> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ inviteToken, username, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request("/api/auth/logout", { method: "POST" });
}

export function getMe(): Promise<CurrentUser> {
  return request("/api/me");
}

export function listChannels(): Promise<Channel[]> {
  return request("/api/channels");
}

export function createChannel(input: { name: string; type: "text" | "voice"; minRole?: Role }): Promise<Channel> {
  return request("/api/channels", { method: "POST", body: JSON.stringify(input) });
}

export function listMessages(channelId: string, opts?: { before?: string; limit?: number }): Promise<Message[]> {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request(`/api/channels/${channelId}/messages${qs ? `?${qs}` : ""}`);
}

export function postMessage(channelId: string, content: string): Promise<Message> {
  return request(`/api/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
}

export function getVoiceToken(channelId: string): Promise<VoiceToken> {
  return request(`/api/channels/${channelId}/voice-token`, { method: "POST" });
}
