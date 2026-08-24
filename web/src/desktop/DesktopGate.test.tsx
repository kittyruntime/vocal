import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopGate } from "./DesktopGate";
import type { DesktopBridge, DesktopConfig } from "./bridge";

function stubDesktop(config: DesktopConfig | null): DesktopBridge {
  const bridge: DesktopBridge = {
    getConfig: vi.fn().mockResolvedValue(config),
    setConfig: vi.fn().mockResolvedValue(undefined),
    clearConfig: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined),
  };
  window.vocalDesktop = bridge;
  return bridge;
}

afterEach(() => {
  delete window.vocalDesktop;
  vi.restoreAllMocks();
});

describe("DesktopGate", () => {
  it("renders children immediately outside the desktop app", () => {
    render(<DesktopGate><div>App content</div></DesktopGate>);
    expect(screen.getByText("App content")).toBeInTheDocument();
  });

  it("applies a stored server config and renders children without asking again", async () => {
    stubDesktop({ serverUrl: "https://vocal.example.com", token: "tok" });
    render(<DesktopGate><div>App content</div></DesktopGate>);
    await waitFor(() => expect(screen.getByText("App content")).toBeInTheDocument());
  });

  it("shows the connect screen when no server is configured, then proceeds once one connects", async () => {
    stubDesktop(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ status: "ok" }) }));
    render(<DesktopGate><div>App content</div></DesktopGate>);
    await waitFor(() => expect(screen.getByText("Connect to a server")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Server address"), "vocal.example.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("App content")).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
