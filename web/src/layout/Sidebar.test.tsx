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

const admin: CurrentUser = { id: "u1", username: "theo", role: "admin" };
const member: CurrentUser = { id: "u2", username: "alice", role: "member" };

const channels: Channel[] = [
  { id: "c1", name: "général", type: "text", minRole: "member", position: 0, createdAt: "now" },
  { id: "c2", name: "salle", type: "voice", minRole: "member", position: 1, createdAt: "now" },
];

function renderSidebar(user: CurrentUser, onSelect = vi.fn(), onCreated = vi.fn()) {
  render(
    <ToastProvider>
      <Sidebar
        channels={channels}
        selectedChannelId="c1"
        onlineUserIds={["u1"]}
        voiceOccupancy={{ c2: [{ userId: "u1", username: "theo" }, { userId: "u2", username: "alice" }] }}
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
    expect(screen.getByText("Salons textuels")).toBeInTheDocument();
    expect(screen.getByText("Salons vocaux")).toBeInTheDocument();
    expect(screen.getByText("général", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("1 en ligne")).toBeInTheDocument();
    expect(screen.getByText("theo (vous)")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("calls onSelectChannel when a channel is clicked", async () => {
    const onSelect = vi.fn();
    renderSidebar(admin, onSelect);
    await userEvent.setup().click(screen.getByText("général", { exact: false }));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("shows the create-channel form only to admins", () => {
    renderSidebar(admin);
    expect(screen.getByLabelText("Nom du nouveau channel")).toBeInTheDocument();
  });

  it("hides the create-channel form from non-admins", () => {
    renderSidebar(member);
    expect(screen.queryByLabelText("Nom du nouveau channel")).not.toBeInTheDocument();
  });

  it("creates a channel and reports it back to the parent", async () => {
    const created: Channel = { id: "c3", name: "annonces", type: "text", minRole: "member", position: 2, createdAt: "now" };
    vi.mocked(api.createChannel).mockResolvedValue(created);
    const onCreated = vi.fn();
    renderSidebar(admin, vi.fn(), onCreated);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nom du nouveau channel"), "annonces");
    await user.click(screen.getByRole("button", { name: "+ Ajouter" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(api.createChannel).toHaveBeenCalledWith({ name: "annonces", type: "text" });
  });
});
