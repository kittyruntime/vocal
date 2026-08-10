import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "../toast/ToastContext";
import { AuthProvider } from "../auth/AuthContext";
import { MainLayout } from "./MainLayout";
import * as api from "../api/client";
import type { Channel, CurrentUser } from "../api/client";
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    listChannels: vi.fn(),
    listMessages: vi.fn(),
    // MainLayout receives currentUser as a prop, but it still mounts inside AuthProvider
    // (to reach useAuth().signOut), whose own bootstrap effect calls getSetupStatus/getMe.
    // Mock those too so that effect doesn't fire real, unmocked fetches during this test.
    getSetupStatus: vi.fn(),
    getMe: vi.fn(),
  };
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.instances = [];
  }
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {
    this.emit("close", {});
  }
  emit(type: string, ev: unknown = {}) {
    this.listeners[type]?.forEach((cb) => cb(ev));
  }
  sendServerEvent(event: unknown) {
    this.emit("message", { data: JSON.stringify(event) });
  }
}

const admin: CurrentUser = { id: "u1", username: "theo", capabilities: ["manage_channels", "manage_server", "moderate", "publish_voice"] };
const generalChannel: Channel = { id: "c1", name: "général", type: "text", requiredCapability: null, position: 0, createdAt: "now" };

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.mocked(api.listChannels).mockResolvedValue([generalChannel]);
  vi.mocked(api.listMessages).mockResolvedValue([]);
  vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
  vi.mocked(api.getMe).mockResolvedValue(admin);
});
afterEach(() => vi.unstubAllGlobals());

function renderLayout() {
  render(
    <ToastProvider>
      <AuthProvider>
        <MainLayout currentUser={admin} />
      </AuthProvider>
    </ToastProvider>,
  );
}

describe("MainLayout", () => {
  it("loads channels and hides the reconnecting banner once the socket opens", async () => {
    renderLayout();
    expect(await screen.findByRole("button", { name: "général" })).toBeInTheDocument();
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    FakeWebSocket.instances[0].emit("open");
    await waitFor(() => expect(screen.queryByText("Connecting…")).not.toBeInTheDocument());
  });

  it("updates presence from WebSocket events", async () => {
    renderLayout();
    await screen.findByRole("button", { name: "général" });
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");
    socket.sendServerEvent({ type: "presence.sync", userIds: ["u1"] });
    await waitFor(() => expect(screen.getByText("1 online")).toBeInTheDocument());
    socket.sendServerEvent({ type: "presence.online", userId: "u2" });
    await waitFor(() => expect(screen.getByText("2 online")).toBeInTheDocument());
  });

  it("appends an incoming message to the selected channel", async () => {
    renderLayout();
    await screen.findByRole("button", { name: "général" });
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");
    socket.sendServerEvent({
      type: "message.created",
      message: { id: "m1", channelId: "c1", userId: "u1", username: "theo", content: "salut", createdAt: "2026-01-01T00:00:00Z" },
    });
    expect(await screen.findByText("salut")).toBeInTheDocument();
  });

});
