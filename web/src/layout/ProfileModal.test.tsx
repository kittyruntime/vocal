import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../api/client";
import { ACCENT_PRESETS, type AccentPreset } from "../api/client";
import * as sounds from "../audio/sounds";
import { ACCENT_PRESET_LABELS } from "../theme/accent";
import { ProfileModal } from "./ProfileModal";

vi.mock("../api/client", async () => ({
  ...(await vi.importActual<typeof import("../api/client")>("../api/client")),
  updateProfile: vi.fn(),
  getSoundSettings: vi.fn(),
  getMySoundVolumes: vi.fn(),
  getMySoundSettings: vi.fn(),
  updateMySoundVolume: vi.fn(),
  updateMySoundSetting: vi.fn(),
  getAppearance: vi.fn(),
  getMyAccent: vi.fn(),
  updateMyAccent: vi.fn(),
}));

vi.mock("../audio/sounds", async () => ({
  ...(await vi.importActual<typeof import("../audio/sounds")>("../audio/sounds")),
  configureSounds: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getSoundSettings).mockResolvedValue({
    message: { enabled: true, hasCustom: false },
    userJoin: { enabled: true, hasCustom: false },
    userLeave: { enabled: true, hasCustom: false },
    muteToggle: { enabled: true, hasCustom: false },
    forceMuted: { enabled: true, hasCustom: false },
    screenShare: { enabled: true, hasCustom: false },
  });
  vi.mocked(api.getMySoundVolumes).mockResolvedValue({ message: 55, userJoin: 55, userLeave: 55, muteToggle: 55, forceMuted: 55, screenShare: 55 });
  vi.mocked(api.getMySoundSettings).mockResolvedValue(Object.fromEntries(api.SOUND_EVENTS.map((event) => [event, { hasCustom: false }])) as api.UserSoundSettings);
  vi.mocked(api.getAppearance).mockResolvedValue({ enabledPresets: ACCENT_PRESETS as unknown as AccentPreset[], defaultPreset: "amber" });
  vi.mocked(api.getMyAccent).mockResolvedValue({ accentPreset: null });
});

describe("ProfileModal", () => {
  it("edits and saves account details", async () => {
    vi.mocked(api.updateProfile).mockResolvedValue({ id: "u1", username: "theophile", capabilities: [] });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", email: "old@example.com", description: "Old", capabilities: [] }} onSaved={onSaved} onClose={onClose} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), "theophile");
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "theo@example.com");
    await user.clear(screen.getByLabelText("About me"));
    await user.type(screen.getByLabelText("About me"), "Hello there");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({
      username: "theophile", email: "theo@example.com", description: "Hello there", avatarUrl: null, bannerUrl: null,
    }));
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows API validation errors", async () => {
    vi.mocked(api.updateProfile).mockRejectedValue(new Error("username taken"));
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("username taken");
  });

  it("adjusts and saves a per-sound volume", async () => {
    vi.mocked(api.updateMySoundVolume).mockResolvedValue({ message: 80, userJoin: 55, userLeave: 55, muteToggle: 55, forceMuted: 55, screenShare: 55 });
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    const slider = await screen.findByLabelText("Message received — 55%");
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(api.updateMySoundVolume).toHaveBeenCalledWith("message", 80));
  });

  it("applies a saved volume to the live sound engine immediately, without a reload", async () => {
    const freshVolumes = { message: 80, userJoin: 55, userLeave: 55, muteToggle: 55, forceMuted: 55, screenShare: 55 };
    vi.mocked(api.updateMySoundVolume).mockResolvedValue(freshVolumes);
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    const slider = await screen.findByLabelText("Message received — 55%");
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(sounds.configureSounds).toHaveBeenCalledWith(
      {
        message: { enabled: true, hasCustom: false },
        userJoin: { enabled: true, hasCustom: false },
        userLeave: { enabled: true, hasCustom: false },
        muteToggle: { enabled: true, hasCustom: false },
        forceMuted: { enabled: true, hasCustom: false },
        screenShare: { enabled: true, hasCustom: false },
      },
      freshVolumes,
      expect.objectContaining({ message: { hasCustom: false } }),
    ));
  });

  it("uploads and resets a personal sound", async () => {
    vi.mocked(api.updateMySoundSetting).mockResolvedValueOnce({ hasCustom: true }).mockResolvedValueOnce({ hasCustom: false });
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    const input = await screen.findByLabelText("Voice join sound file");
    await userEvent.setup().upload(input, new File([new Uint8Array([1, 2, 3])], "join.mp3", { type: "audio/mpeg" }));
    await waitFor(() => expect(api.updateMySoundSetting).toHaveBeenCalledWith("userJoin", expect.stringMatching(/^data:audio\/mpeg;base64,/)));
    await userEvent.setup().click(await screen.findByLabelText("Reset Voice join"));
    await waitFor(() => expect(api.updateMySoundSetting).toHaveBeenLastCalledWith("userJoin", null));
  });

  it("renders only the currently-enabled accent swatches", async () => {
    vi.mocked(api.getAppearance).mockResolvedValue({ enabledPresets: ["amber", "magenta", "glacier"], defaultPreset: "amber" });
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: ACCENT_PRESET_LABELS.amber })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: ACCENT_PRESET_LABELS.magenta })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ACCENT_PRESET_LABELS.glacier })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCENT_PRESET_LABELS["ember-red"] })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCENT_PRESET_LABELS.emerald })).not.toBeInTheDocument();
  });

  it("marks the user's current accent preset as pressed", async () => {
    vi.mocked(api.getMyAccent).mockResolvedValue({ accentPreset: "magenta" });
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    const pressedButton = await screen.findByRole("button", { name: ACCENT_PRESET_LABELS.magenta, pressed: true });
    expect(pressedButton).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ACCENT_PRESET_LABELS.amber, pressed: false })).toBeInTheDocument();
  });

  it("selects an accent color and updates the pressed state", async () => {
    vi.mocked(api.getMyAccent).mockResolvedValue({ accentPreset: null });
    vi.mocked(api.updateMyAccent).mockResolvedValue({ accentPreset: "emerald" });
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    const swatch = await screen.findByRole("button", { name: ACCENT_PRESET_LABELS.emerald });
    await userEvent.setup().click(swatch);
    await waitFor(() => expect(api.updateMyAccent).toHaveBeenCalledWith("emerald"));
    await waitFor(() => expect(swatch).toHaveAttribute("aria-pressed", "true"));
  });
});
