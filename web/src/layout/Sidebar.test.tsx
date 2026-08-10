import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast/ToastContext";
import { Sidebar } from "./Sidebar";
import * as api from "../api/client";
import type { Channel, CurrentUser } from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, createChannel: vi.fn() };
});

const admin: CurrentUser = { id: "u1", username: "theo", capabilities: ["manage_channels", "manage_server", "moderate", "publish_voice"] };
const member: CurrentUser = { id: "u2", username: "alice", capabilities: [] };

const channels: Channel[] = [
  { id: "c1", name: "général", type: "text", requiredCapability: null, position: 0, createdAt: "now" },
  { id: "c2", name: "salle", type: "voice", requiredCapability: null, position: 1, createdAt: "now" },
];

function renderSidebar(user: CurrentUser, onSelect = vi.fn(), onCreated = vi.fn(), unreadChannelIds: string[] = []) {
  render(
    <ToastProvider>
      <Sidebar
        channels={channels}
        selectedChannelId="c1"
        onlineUserIds={["u1"]}
        voiceOccupancy={{ c2: [{ userId: "u1", username: "theo" }, { userId: "u2", username: "alice" }] }}
        unreadChannelIds={unreadChannelIds}
        currentUser={user}
        onSelectChannel={onSelect}
        onChannelCreated={onCreated}
      />
    </ToastProvider>,
  );
}

beforeEach(() => vi.mocked(api.createChannel).mockReset());

describe("Sidebar", () => {
  it("groups channels by type and shows the presence count", () => {
    renderSidebar(admin);
    expect(screen.getByText("Text channels")).toBeInTheDocument();
    expect(screen.getByText("Voice channels")).toBeInTheDocument();
    expect(screen.getByText("général", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("1 online")).toBeInTheDocument();
    expect(screen.getByText("theo (you)")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("calls onSelectChannel when a channel is clicked", async () => {
    const onSelect = vi.fn();
    renderSidebar(admin, onSelect);
    await userEvent.setup().click(screen.getByText("général", { exact: false }));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("shows an accessible unread marker on text channels", () => {
    renderSidebar(admin, vi.fn(), vi.fn(), ["c1"]);
    const channel = screen.getByRole("button", { name: "général, unread messages" });
    expect(channel).toHaveClass("has-unread");
    expect(channel.querySelector(".channel-unread-dot")).toBeInTheDocument();
  });

  it("shows the create-channel form only to admins", () => {
    renderSidebar(admin);
    expect(screen.getByLabelText("New channel name")).toBeInTheDocument();
  });

  it("hides the create-channel form from non-admins", () => {
    renderSidebar(member);
    expect(screen.queryByLabelText("New channel name")).not.toBeInTheDocument();
  });

  it("shows a per-channel settings icon for admins, opening that channel's settings", async () => {
    renderSidebar(admin);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings for salle" }));
    expect(await screen.findByRole("dialog", { name: "Settings for salle" })).toBeInTheDocument();
  });

  it("hides the per-channel settings icon from non-admins", () => {
    renderSidebar(member);
    expect(screen.queryByRole("button", { name: "Settings for salle" })).not.toBeInTheDocument();
  });

  it("creates a channel and reports it back to the parent", async () => {
    const created: Channel = { id: "c3", name: "annonces", type: "text", requiredCapability: null, position: 2, createdAt: "now" };
    vi.mocked(api.createChannel).mockResolvedValue(created);
    const onCreated = vi.fn();
    renderSidebar(admin, vi.fn(), onCreated);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New channel name"), "annonces");
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(api.createChannel).toHaveBeenCalledWith({ name: "annonces", type: "text" });
  });
});
