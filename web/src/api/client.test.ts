import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, getSetupStatus, login, getMe, getVoiceToken, listChannels, postMessage, register, updateProfile } from "./client";

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

afterEach(() => vi.unstubAllGlobals());

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
    await updateProfile({ username: "theophile", email: "theo@example.com", description: "Hello", avatarUrl: null });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ username: "theophile", email: "theo@example.com", description: "Hello", avatarUrl: null });
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
    const msg = await postMessage("c1", "hi");
    expect(msg.content).toBe("hi");
  });

  it("posts files as multipart data without forcing a JSON content type", async () => {
    mockFetchOnce(201, { id: "m1", content: "photo", attachments: [] });
    const file = new File(["image"], "photo.png", { type: "image/png" });
    await postMessage("c1", "photo", [file]);
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
