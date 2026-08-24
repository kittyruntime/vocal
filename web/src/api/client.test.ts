import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ApiError, connectToServer, getServerBase, getSetupStatus, getWsUrl, login, getMe, getVoiceToken,
  listChannels, postMessage, register, setAuthToken, setServerBase, updateProfile,
} from "./client";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setServerBase(null);
  setAuthToken(null);
});

describe("api client", () => {
  it("getSetupStatus parses the response body", async () => {
    mockFetchOnce(200, { done: true });
    await expect(getSetupStatus()).resolves.toEqual({ done: true });
  });

  it("sends credentials and a JSON body on login", async () => {
    mockFetchOnce(200, { ok: true });
    await login("theo", "hunter2hunter2");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ username: "theo", password: "hunter2hunter2" });
  });

  it("throws ApiError with the server message on failure", async () => {
    mockFetchOnce(401, { error: "invalid credentials" });
    await expect(login("theo", "wrong")).rejects.toMatchObject({ status: 401, message: "invalid credentials" });
  });

  it("registers without an invite token", async () => {
    mockFetchOnce(201, { ok: true });
    await register("alice", "alicepass123");
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ username: "alice", password: "alicepass123" });
  });

  it("getMe rejects with an ApiError instance when unauthenticated", async () => {
    mockFetchOnce(401, { error: "authentication required" });
    await expect(getMe()).rejects.toBeInstanceOf(ApiError);
  });

  it("updates the current profile", async () => {
    mockFetchOnce(200, { id: "u1", username: "theophile" });
    await updateProfile({ username: "theophile", email: "theo@example.com", description: "Hello", avatarUrl: null, bannerUrl: null });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ username: "theophile", email: "theo@example.com", description: "Hello", avatarUrl: null, bannerUrl: null });
  });

  it("listChannels returns the parsed array", async () => {
    mockFetchOnce(200, [
      { id: "1", name: "général", type: "text", minRole: "member", position: 0, createdAt: "now" },
    ]);
    const channels = await listChannels();
    expect(channels).toHaveLength(1);
  });

  it("postMessage sends the content and returns the created message", async () => {
    mockFetchOnce(201, {
      id: "m1", channelId: "c1", userId: "u1", username: "theo", content: "hi", createdAt: "now",
    });
    const msg = await postMessage({ channelId: "c1" }, "hi");
    expect(msg.content).toBe("hi");
  });

  it("posts files as multipart data without forcing a JSON content type", async () => {
    mockFetchOnce(201, { id: "m1", content: "photo", attachments: [] });
    const file = new File(["image"], "photo.png", { type: "image/png" });
    await postMessage({ channelId: "c1" }, "photo", [file]);
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("content")).toBe("photo");
    expect((init.body as FormData).getAll("files")).toHaveLength(1);
    expect(init.headers).not.toHaveProperty("content-type");
  });

  it("requests a short-lived token for a voice channel", async () => {
    mockFetchOnce(201, { token: "jwt", url: "ws://localhost:7880" });
    await expect(getVoiceToken("c2")).resolves.toEqual({ token: "jwt", url: "ws://localhost:7880" });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/channels/c2/voice-token");
    expect(init.method).toBe("POST");
    expect(init.headers).not.toHaveProperty("content-type");
  });
});

describe("desktop server configuration", () => {
  it("connectToServer commits the base on success and confirms via /api/health", async () => {
    mockFetchOnce(200, { status: "ok" });
    const ok = await connectToServer("https://vocal.example.com");
    expect(ok).toBe(true);
    expect(getServerBase()).toBe("https://vocal.example.com/");
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/health");
  });

  it("connectToServer's pre-auth health check never asks for credentials (regression: was blocked by CORS)", async () => {
    // Bug caught live: the health check runs before any token exists, so a
    // credentials check keyed off authToken alone sent "include" here --
    // the server's CORS policy for cross-origin requests doesn't allow
    // credentialed requests, and the browser fails the fetch outright.
    mockFetchOnce(200, { status: "ok" });
    await connectToServer("https://vocal.example.com");
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.credentials).toBe("omit");
  });

  it("connectToServer reverts the base when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const ok = await connectToServer("https://not-a-vocal-server.example");
    expect(ok).toBe(false);
    expect(getServerBase()).toBeNull();
  });

  it("sends an Authorization header instead of cookies once a token is set", async () => {
    setServerBase("https://vocal.example.com");
    setAuthToken("secret-token");
    mockFetchOnce(200, { id: "u1" });
    await getMe();
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.credentials).toBe("omit");
    expect(init.headers.authorization).toBe("Bearer secret-token");
  });

  it("getWsUrl resolves against the configured server and exchanges the token for a one-time ticket", async () => {
    setServerBase("https://vocal.example.com");
    setAuthToken("secret-token");
    mockFetchOnce(200, { ticket: "one-shot-ticket" });
    await expect(getWsUrl()).resolves.toBe("wss://vocal.example.com/ws?ticket=one-shot-ticket");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/ws-ticket");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer secret-token");
  });

  it("getWsUrl falls back to the page's own origin with no server configured, no ticket exchange needed", async () => {
    await expect(getWsUrl()).resolves.toBe(`${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`);
  });
});
