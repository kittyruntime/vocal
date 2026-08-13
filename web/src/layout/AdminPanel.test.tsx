import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminPanel } from "./AdminPanel";
import * as api from "../api/client";
import { ACCENT_PRESETS } from "../api/client";
import type { AccentPreset, AdminUser, AppearanceSettings, CurrentUser, SoundSettings } from "../api/client";
import { ACCENT_PRESET_LABELS } from "../theme/accent";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, listAdminUsers: vi.fn(), getAdminSettings: vi.fn(), updateAdminSettings: vi.fn(), listRoles: vi.fn(), createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn(), setUserRoles: vi.fn(), kickUser: vi.fn(), banUser: vi.fn(), unbanUser: vi.fn(), setUserVoiceMuted: vi.fn(), getSoundSettings: vi.fn(), updateSoundSetting: vi.fn(), getAppearance: vi.fn(), updateAppearance: vi.fn() };
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

const DEFAULT_APPEARANCE: AppearanceSettings = { enabledPresets: [...ACCENT_PRESETS], defaultPreset: "amber" };

function renderPanel(users: AdminUser[] = [alice], openMembers = true, soundSettings: SoundSettings = DEFAULT_SOUND_SETTINGS, appearance: AppearanceSettings = DEFAULT_APPEARANCE, currentUser: CurrentUser = admin) {
  mockListUsers(users);
  vi.mocked(api.getAdminSettings).mockResolvedValue({ registrationOpen: true, maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
  vi.mocked(api.listRoles).mockResolvedValue([]);
  vi.mocked(api.getSoundSettings).mockResolvedValue(soundSettings);
  vi.mocked(api.getAppearance).mockResolvedValue(appearance);
  const result = render(
    <AdminPanel currentUser={currentUser} onClose={vi.fn()} />,
  );
  if (openMembers) fireEvent.click(screen.getByRole("button", { name: /Members/ }));
  return result;
}

beforeEach(() => {
  vi.mocked(api.kickUser).mockReset();
  vi.mocked(api.banUser).mockReset();
  vi.mocked(api.unbanUser).mockReset();
  vi.mocked(api.setUserVoiceMuted).mockReset();
  vi.mocked(api.updateAppearance).mockReset();
  vi.mocked(api.updateAdminSettings).mockReset();
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

describe("AdminPanel general", () => {
  it("toggles public registration via the Switch primitive", async () => {
    vi.mocked(api.updateAdminSettings).mockResolvedValue({ registrationOpen: false, maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Public registration" }));
    await waitFor(() => expect(api.updateAdminSettings).toHaveBeenCalledWith(expect.objectContaining({ registrationOpen: false })));
  });

  it("saves attachment limits via an explicit Save button, not onBlur", async () => {
    vi.mocked(api.updateAdminSettings).mockResolvedValue({ registrationOpen: true, maxImageSizeMb: 8, maxFileSizeMb: 10, maxMessageLength: 4000 });
    renderPanel([], false);
    const user = userEvent.setup();
    const imageInput = await screen.findByLabelText("Images (MB)");
    await user.clear(imageInput);
    await user.type(imageInput, "8");
    expect(api.updateAdminSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateAdminSettings).toHaveBeenCalledWith(expect.objectContaining({ maxImageSizeMb: 8 })));
  });

  it("shows Saving… and disables the button while the attachment-limits save is in flight", async () => {
    let resolveSave: (value: api.ServerSettings) => void = () => {};
    vi.mocked(api.updateAdminSettings).mockReturnValue(new Promise<api.ServerSettings>((resolve) => { resolveSave = resolve; }));
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    resolveSave({ registrationOpen: true, maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
  });

  it("saves the message-length limit via its own separate Save button", async () => {
    vi.mocked(api.updateAdminSettings).mockResolvedValue({ registrationOpen: true, maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 2000 });
    renderPanel([], false);
    const user = userEvent.setup();
    const lengthInput = await screen.findByLabelText("Characters per message");
    await user.clear(lengthInput);
    await user.type(lengthInput, "2000");
    await user.click(screen.getByRole("button", { name: "Save length" }));
    await waitFor(() => expect(api.updateAdminSettings).toHaveBeenCalledWith(expect.objectContaining({ maxMessageLength: 2000 })));
  });
});

describe("AdminPanel sounds", () => {
  it("toggles a sound's enabled state", async () => {
    vi.mocked(api.updateSoundSetting).mockResolvedValue({ enabled: false, hasCustom: false });
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sounds" }));
    await user.click(await screen.findByRole("switch", { name: "Message received enabled" }));
    await waitFor(() => expect(api.updateSoundSetting).toHaveBeenCalledWith("message", { enabled: false }));
  });

  it("renders the sound toggle as a Switch, not a text-label button", async () => {
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sounds" }));
    const toggles = await screen.findAllByRole("switch");
    expect(toggles.length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: "On" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Off" })).toHaveLength(0);
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

describe("AdminPanel appearance", () => {
  it("shows the Appearance tab only to a user with manage_server", async () => {
    const adminRender = renderPanel([alice], false);
    expect(await within(adminRender.container).findByRole("button", { name: "Appearance" })).toBeInTheDocument();

    const member: CurrentUser = { id: "u3", username: "bob", capabilities: [] };
    mockListUsers([alice]);
    const memberRender = render(<AdminPanel currentUser={member} onClose={vi.fn()} />);
    await within(memberRender.container).findByText("alice");
    expect(within(memberRender.container).queryByRole("button", { name: "Appearance" })).not.toBeInTheDocument();
  });

  it("toggles a preset's enabled state when its swatch is clicked", async () => {
    const enabledAfterToggle = ACCENT_PRESETS.filter((preset) => preset !== "magenta") as AccentPreset[];
    vi.mocked(api.updateAppearance).mockResolvedValue({ enabledPresets: enabledAfterToggle, defaultPreset: "amber" });
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await user.click(await screen.findByRole("button", { name: ACCENT_PRESET_LABELS.magenta }));
    await waitFor(() => expect(api.updateAppearance).toHaveBeenCalledWith({ enabledPresets: enabledAfterToggle }));
  });

  it("shows an error and does not call the API when disabling the last enabled preset", async () => {
    renderPanel([], false, DEFAULT_SOUND_SETTINGS, { enabledPresets: ["amber"], defaultPreset: "amber" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await user.click(await screen.findByRole("button", { name: ACCENT_PRESET_LABELS.amber }));
    expect(await screen.findByText("At least one accent preset must stay enabled.")).toBeInTheDocument();
    expect(api.updateAppearance).not.toHaveBeenCalled();
  });

  it("shows an error and does not call the API when disabling the current default preset (with others still enabled)", async () => {
    renderPanel([], false, DEFAULT_SOUND_SETTINGS, { enabledPresets: [...ACCENT_PRESETS], defaultPreset: "amber" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await user.click(await screen.findByRole("button", { name: ACCENT_PRESET_LABELS.amber }));
    expect(await screen.findByText("Set a different default before disabling the current default preset.")).toBeInTheDocument();
    expect(api.updateAppearance).not.toHaveBeenCalled();
  });

  it("sets a new default preset via 'Set as default', which is disabled for the current default", async () => {
    vi.mocked(api.updateAppearance).mockResolvedValue({ enabledPresets: [...ACCENT_PRESETS], defaultPreset: "glacier" });
    renderPanel([], false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    const amberRow = (await screen.findByRole("button", { name: ACCENT_PRESET_LABELS.amber })).closest(".admin-accent-row") as HTMLElement;
    expect(within(amberRow).getByRole("button", { name: `Set ${ACCENT_PRESET_LABELS.amber} as default` })).toBeDisabled();
    const glacierRow = screen.getByRole("button", { name: ACCENT_PRESET_LABELS.glacier }).closest(".admin-accent-row") as HTMLElement;
    await user.click(within(glacierRow).getByRole("button", { name: `Set ${ACCENT_PRESET_LABELS.glacier} as default` }));
    await waitFor(() => expect(api.updateAppearance).toHaveBeenCalledWith({ defaultPreset: "glacier" }));
    expect(await within(glacierRow).findByRole("button", { name: `Set ${ACCENT_PRESET_LABELS.glacier} as default` })).toBeDisabled();
  });
});
