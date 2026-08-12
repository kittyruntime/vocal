import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminPanel } from "./AdminPanel";
import * as api from "../api/client";
import type { AdminUser, CurrentUser, SoundSettings } from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, listAdminUsers: vi.fn(), getAdminSettings: vi.fn(), listRoles: vi.fn(), createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn(), setUserRoles: vi.fn(), kickUser: vi.fn(), banUser: vi.fn(), unbanUser: vi.fn(), setUserVoiceMuted: vi.fn(), getSoundSettings: vi.fn(), updateSoundSetting: vi.fn() };
});

const admin: CurrentUser = { id: "u1", username: "theo", capabilities: ["manage_channels", "manage_server", "moderate", "publish_voice"] };
const alice: AdminUser = { id: "u2", username: "alice", capabilities: [], createdAt: "now", bannedAt: null, voiceMuted: false };

// Mirrors the server's search + page/limit slicing so tests can exercise
// pagination and search without caring which of the two drives a given
// assertion.
function mockListUsers(users: AdminUser[]) {
  vi.mocked(api.listAdminUsers).mockImplementation(async (opts) => {
    const search = opts?.search?.toLocaleLowerCase() ?? "";
    const filtered = search ? users.filter((user) => user.username.toLocaleLowerCase().includes(search)) : users;
    const page = opts?.page ?? 1;
    const limit = opts?.limit ?? filtered.length;
    return { users: filtered.slice((page - 1) * limit, page * limit), total: filtered.length };
  });
}

const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  message: { enabled: true, hasCustom: false },
  userJoin: { enabled: true, hasCustom: false },
  userLeave: { enabled: true, hasCustom: false },
  muteToggle: { enabled: true, hasCustom: false },
  forceMuted: { enabled: true, hasCustom: false },
  screenShare: { enabled: true, hasCustom: false },
};

function renderPanel(users: AdminUser[] = [alice], openMembers = true, soundSettings: SoundSettings = DEFAULT_SOUND_SETTINGS) {
  mockListUsers(users);
  vi.mocked(api.getAdminSettings).mockResolvedValue({ registrationOpen: true, maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
  vi.mocked(api.listRoles).mockResolvedValue([]);
  vi.mocked(api.getSoundSettings).mockResolvedValue(soundSettings);
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

  it("searches members server-side, debounced, and resets back to page 1", async () => {
    const members = Array.from({ length: 9 }, (_, index): AdminUser => ({ ...alice, id: `u${index + 2}`, username: `member-${index + 1}` }));
    renderPanel(members);
    await screen.findByText("member-8");
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("member-9");

    await userEvent.setup().type(screen.getByLabelText("Search members"), "member-9");
    await waitFor(() => expect(api.listAdminUsers).toHaveBeenLastCalledWith({ search: "member-9", page: 1, limit: 8 }));
    expect(await screen.findByText("member-9")).toBeInTheDocument();
    expect(screen.queryByText("member-8")).not.toBeInTheDocument();
    expect(screen.queryByText(/Page \d of \d/)).not.toBeInTheDocument();
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

describe("AdminPanel sounds", () => {
  it("toggles a sound's enabled state", async () => {
    vi.mocked(api.updateSoundSetting).mockResolvedValue({ enabled: false, hasCustom: false });
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sounds" }));
    // Every sound row starts "On" by default, so the accessible name alone
    // doesn't uniquely identify a row; SOUND_EVENTS[0] is "message", so the
    // first match is its toggle, matching the assertion below.
    const onButtons = await screen.findAllByRole("button", { name: "On" });
    await user.click(onButtons[0]);
    await waitFor(() => expect(api.updateSoundSetting).toHaveBeenCalledWith("message", { enabled: false }));
  });

  it("uploads a valid audio file and sends it as a base64 data URL", async () => {
    vi.mocked(api.updateSoundSetting).mockReset();
    vi.mocked(api.updateSoundSetting).mockResolvedValue({ enabled: true, hasCustom: true });
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sounds" }));
    const row = (await screen.findByText("Message received")).closest(".sound-setting-row")!;
    const fileInput = row.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "test.mp3", { type: "audio/mpeg" });
    await user.upload(fileInput, file);
    await waitFor(() => expect(api.updateSoundSetting).toHaveBeenCalledWith("message", { audioData: expect.stringMatching(/^data:audio\/mpeg;base64,/) }));
  });

  it("rejects a file with a disallowed MIME type without calling the API", async () => {
    vi.mocked(api.updateSoundSetting).mockReset();
    renderPanel([], false);
    // applyAccept: false — the input's accept attribute is only an OS file-picker
    // hint, not enforcement; disabling userEvent's default filtering lets a
    // mismatched file reach the change handler so we can exercise the
    // component's own MIME regex check.
    const user = userEvent.setup({ applyAccept: false });
    await user.click(screen.getByRole("button", { name: "Sounds" }));
    const row = (await screen.findByText("Message received")).closest(".sound-setting-row")!;
    const fileInput = row.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "test.txt", { type: "text/plain" });
    await user.upload(fileInput, file);
    expect(await screen.findByText("Choose an MP3, OGG, WAV or WebM audio file.")).toBeInTheDocument();
    expect(api.updateSoundSetting).not.toHaveBeenCalled();
  });

  it("rejects an oversized file without calling the API", async () => {
    vi.mocked(api.updateSoundSetting).mockReset();
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sounds" }));
    const row = (await screen.findByText("Message received")).closest(".sound-setting-row")!;
    const fileInput = row.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.mp3", { type: "audio/mpeg" });
    await user.upload(fileInput, file);
    expect(await screen.findByText("The sound file must be smaller than 5 MB.")).toBeInTheDocument();
    expect(api.updateSoundSetting).not.toHaveBeenCalled();
  });

  it("resets a sound to default once a custom upload exists", async () => {
    vi.mocked(api.updateSoundSetting).mockResolvedValue({ enabled: true, hasCustom: false });
    // Passed through renderPanel (rather than set via a prior mockResolvedValue
    // call) so it isn't clobbered by renderPanel's own default sound-settings
    // mock, which is configured after this call would otherwise run.
    renderPanel([], false, {
      message: { enabled: true, hasCustom: true },
      userJoin: { enabled: true, hasCustom: false },
      userLeave: { enabled: true, hasCustom: false },
      muteToggle: { enabled: true, hasCustom: false },
      forceMuted: { enabled: true, hasCustom: false },
      screenShare: { enabled: true, hasCustom: false },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sounds" }));
    await user.click(await screen.findByRole("button", { name: "Reset" }));
    await waitFor(() => expect(api.updateSoundSetting).toHaveBeenCalledWith("message", { audioData: null }));
  });
});
