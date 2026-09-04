import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { setAuthToken, setServerBase } from "../api/client";

afterEach(() => {
  vi.unstubAllGlobals();
  setServerBase(null);
  setAuthToken(null);
});

describe("AuthenticatedImage", () => {
  it("renders a plain img without fetching when using cookie auth (no token)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(<AuthenticatedImage src="/api/users/u1/avatar" alt="" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/users/u1/avatar");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches with the Bearer token and renders a blob URL when token auth is set", async () => {
    setServerBase("https://vocal.example.com");
    setAuthToken("secret-token");
    const blob = new Blob(["img"], { type: "image/png" });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetchSpy);
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      const { container } = render(<AuthenticatedImage src="/api/users/u1/avatar" alt="" />);
      await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:mock-url"));
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers.authorization).toBe("Bearer secret-token");
    } finally {
      createSpy.mockRestore();
      revokeSpy.mockRestore();
    }
  });

  it("passes data: URLs through without fetching", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setAuthToken("secret-token");
    const { container } = render(<AuthenticatedImage src="data:image/png;base64,abc" alt="preview" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,abc");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
