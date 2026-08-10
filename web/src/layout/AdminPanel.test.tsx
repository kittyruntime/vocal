import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminPanel } from "./AdminPanel";
import * as api from "../api/client";
import type { AdminUser, CurrentUser } from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, listAdminUsers: vi.fn(), getAdminSettings: vi.fn(), kickUser: vi.fn(), banUser: vi.fn(), unbanUser: vi.fn(), setUserVoiceMuted: vi.fn() };
});

const admin: CurrentUser = { id: "u1", username: "theo", capabilities: ["manage_channels", "manage_server", "moderate", "publish_voice"] };
const alice: AdminUser = { id: "u2", username: "alice", capabilities: [], createdAt: "now", bannedAt: null, voiceMuted: false };

function renderPanel(users: AdminUser[] = [alice], openMembers = true) {
  vi.mocked(api.listAdminUsers).mockResolvedValue(users);
  vi.mocked(api.getAdminSettings).mockResolvedValue({ registrationOpen: true, maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
  const result = render(
    <AdminPanel currentUser={admin} onClose={vi.fn()} />,
  );
  if (openMembers) fireEvent.click(screen.getByRole("button", { name: /Members/ }));
  return result;
}

beforeEach(() => {
  vi.mocked(api.kickUser).mockReset();
  vi.mocked(api.banUser).mockReset();
  vi.mocked(api.unbanUser).mockReset();
  vi.mocked(api.setUserVoiceMuted).mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("AdminPanel moderation", () => {
  it("opens on General and paginates the member directory", async () => {
    const members = Array.from({ length: 9 }, (_, index): AdminUser => ({ ...alice, id: `u${index + 2}`, username: `member-${index + 1}` }));
    renderPanel(members, false);
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.setup().click(screen.getByRole("button", { name: /Members/ }));
    expect(await screen.findByText("member-8")).toBeInTheDocument();
    expect(screen.queryByText("member-9")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("member-9")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("kicks a user after confirmation", async () => {
    vi.mocked(api.kickUser).mockResolvedValue({ ok: true });
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Kick" }));
    await waitFor(() => expect(api.kickUser).toHaveBeenCalledWith("u2"));
  });

  it("does not kick when the confirmation is declined", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Kick" }));
    expect(api.kickUser).not.toHaveBeenCalled();
  });

  it("bans a user and reflects the badge", async () => {
    const banned: AdminUser = { ...alice, bannedAt: "2026-08-10T00:00:00Z" };
    vi.mocked(api.banUser).mockResolvedValue(banned);
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Ban" }));
    expect(await screen.findByText("Banned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unban" })).toBeInTheDocument();
  });

  it("unbans a user without a confirmation prompt", async () => {
    vi.mocked(window.confirm).mockClear();
    vi.mocked(api.unbanUser).mockResolvedValue({ ...alice, bannedAt: null });
    renderPanel([{ ...alice, bannedAt: "2026-08-10T00:00:00Z" }]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unban" }));
    await waitFor(() => expect(api.unbanUser).toHaveBeenCalledWith("u2"));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("force-mutes a user and exposes the persistent status", async () => {
    vi.mocked(api.setUserVoiceMuted).mockResolvedValue({ ...alice, voiceMuted: true });
    renderPanel();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Force mute" }));
    await waitFor(() => expect(api.setUserVoiceMuted).toHaveBeenCalledWith("u2", true));
    expect(await screen.findByText("Voice muted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow voice" })).toBeInTheDocument();
  });

  it("shows an error toast-equivalent message when self-ban is rejected", async () => {
    vi.mocked(api.banUser).mockRejectedValue(new api.ApiError(409, "cannot ban yourself"));
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Ban" }));
    expect(await screen.findByText("You cannot ban yourself.")).toBeInTheDocument();
  });

  it("hides moderation actions for the current admin's own row", async () => {
    renderPanel([{ id: admin.id, username: admin.username, capabilities: ["manage_channels", "manage_server", "moderate", "publish_voice"], createdAt: "now", bannedAt: null, voiceMuted: false }, alice]);
    await screen.findByText("alice");
    const rows = screen.getAllByText(/theo|alice/).map((el) => el.closest(".admin-user"));
    const theoRow = rows.find((row) => row?.textContent?.includes("theo"));
    expect(theoRow?.querySelector(".admin-user-actions")).toBeNull();
  });
});
