import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../api/client";
import { ProfileModal } from "./ProfileModal";

vi.mock("../api/client", async () => ({
  ...(await vi.importActual<typeof import("../api/client")>("../api/client")),
  updateProfile: vi.fn(),
  getSoundSettings: vi.fn(),
  getMySoundVolumes: vi.fn(),
  updateMySoundVolume: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getSoundSettings).mockResolvedValue({
    message: { enabled: true, hasCustom: false },
    userJoin: { enabled: true, hasCustom: false },
    userLeave: { enabled: true, hasCustom: false },
    muteToggle: { enabled: true, hasCustom: false },
    forceMuted: { enabled: true, hasCustom: false },
  });
  vi.mocked(api.getMySoundVolumes).mockResolvedValue({ message: 55, userJoin: 55, userLeave: 55, muteToggle: 55, forceMuted: 55 });
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
    vi.mocked(api.updateMySoundVolume).mockResolvedValue({ message: 80, userJoin: 55, userLeave: 55, muteToggle: 55, forceMuted: 55 });
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    const slider = await screen.findByLabelText("Message received volume");
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.mouseUp(slider);
    await waitFor(() => expect(api.updateMySoundVolume).toHaveBeenCalledWith("message", 80));
  });
});
