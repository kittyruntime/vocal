import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast/ToastContext";
import { VoiceView } from "./VoiceView";
import * as api from "../api/client";

const connect = vi.fn();
const disconnect = vi.fn();
const setMicrophoneEnabled = vi.fn();

vi.mock("livekit-client", () => ({
  Room: class {
    connect = connect;
    disconnect = disconnect;
    localParticipant = { setMicrophoneEnabled };
    on() { return this; }
  },
  RoomEvent: { TrackSubscribed: "trackSubscribed", TrackUnsubscribed: "trackUnsubscribed", Disconnected: "disconnected" },
  Track: { Kind: { Audio: "audio" } },
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, getVoiceToken: vi.fn() };
});

const channel = { id: "c2", name: "salle", type: "voice", minRole: "member", position: 0, createdAt: "now" } as const;
const currentUser = { id: "u1", username: "theo", role: "member" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getVoiceToken).mockResolvedValue({ token: "jwt", url: "ws://livekit" });
  connect.mockResolvedValue(undefined);
  disconnect.mockResolvedValue(undefined);
  setMicrophoneEnabled.mockResolvedValue(undefined);
});

function renderView() {
  render(<ToastProvider><VoiceView channel={channel} currentUser={currentUser} /></ToastProvider>);
}

describe("VoiceView", () => {
  it("joins LiveKit and enables the microphone", async () => {
    renderView();
    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoindre" }));
    await screen.findByText("Connecté en tant que theo");
    expect(api.getVoiceToken).toHaveBeenCalledWith("c2");
    expect(connect).toHaveBeenCalledWith("ws://livekit", "jwt");
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it("mutes and leaves the room", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rejoindre" }));
    await user.click(await screen.findByRole("button", { name: "Couper le micro" }));
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button", { name: "Quitter" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Rejoindre" })).toBeInTheDocument();
  });
});
