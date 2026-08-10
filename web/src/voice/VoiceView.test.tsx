import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast/ToastContext";
import { VoiceView } from "./VoiceView";
import * as api from "../api/client";

const connect = vi.fn();
const disconnect = vi.fn();
const setMicrophoneEnabled = vi.fn();
const setCameraEnabled = vi.fn();
const setScreenShareEnabled = vi.fn();
const getTrackPublication = vi.fn();
const switchActiveDevice = vi.fn();

vi.mock("livekit-client", () => ({
  Room: class {
    static getLocalDevices() { return Promise.resolve([]); }
    connect = connect;
    disconnect = disconnect;
    switchActiveDevice = switchActiveDevice;
    localParticipant = { setMicrophoneEnabled, setCameraEnabled, setScreenShareEnabled, getTrackPublication };
    on() { return this; }
  },
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    LocalTrackUnpublished: "localTrackUnpublished",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    Disconnected: "disconnected",
  },
  Track: {
    Kind: { Audio: "audio", Video: "video" },
    Source: { Camera: "camera", ScreenShare: "screen_share" },
  },
  createAudioAnalyser: vi.fn(),
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
  switchActiveDevice.mockResolvedValue(true);
  setMicrophoneEnabled.mockResolvedValue(undefined);
  getTrackPublication.mockReturnValue(undefined);
  const videoTrack = {
    attach: vi.fn(() => document.createElement("video")),
    detach: vi.fn(() => []),
  };
  setCameraEnabled.mockResolvedValue({ track: videoTrack });
  setScreenShareEnabled.mockResolvedValue({ track: videoTrack });
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

  it("controls deafen, camera, and screen sharing", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rejoindre" }));

    await user.click(await screen.findByRole("button", { name: "Assourdir" }));
    expect(screen.getByRole("button", { name: "Rétablir le son" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Activer la caméra" }));
    expect(setCameraEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Arrêter la caméra" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Partager l’écran" }));
    expect(setScreenShareEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Arrêter le partage" })).toBeInTheDocument();
  });
});
