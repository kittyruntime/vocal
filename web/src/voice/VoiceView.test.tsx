import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast/ToastContext";
import { VoiceView } from "./VoiceView";
import * as api from "../api/client";
import { ConnectionError } from "livekit-client";

const connect = vi.fn();
const disconnect = vi.fn();
const setMicrophoneEnabled = vi.fn();
const setCameraEnabled = vi.fn();
const setScreenShareEnabled = vi.fn();
const getTrackPublication = vi.fn();
const switchActiveDevice = vi.fn();
const roomHandlers = new Map<string, (...args: unknown[]) => void>();

vi.mock("livekit-client", () => ({
  Room: class {
    static getLocalDevices() { return Promise.resolve([]); }
    remoteParticipants = new Map();
    connect = connect;
    disconnect = disconnect;
    switchActiveDevice = switchActiveDevice;
    localParticipant = { setMicrophoneEnabled, setCameraEnabled, setScreenShareEnabled, getTrackPublication };
    on(event: string, handler: (...args: unknown[]) => void) { roomHandlers.set(event, handler); return this; }
  },
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    LocalTrackUnpublished: "localTrackUnpublished",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    Disconnected: "disconnected",
  },
  Track: {
    Kind: { Audio: "audio", Video: "video" },
    Source: { Camera: "camera", ScreenShare: "screen_share" },
  },
  createAudioAnalyser: vi.fn(),
  MediaDeviceFailure: Object.assign(
    { PermissionDenied: "PermissionDenied", NotFound: "NotFound", DeviceInUse: "DeviceInUse", Other: "Other" },
    {
      // Mirrors livekit-client's own name-based classification so tests can
      // pass real-shaped DOMException-like errors ({ name: "NotAllowedError" }).
      getFailure(error: unknown) {
        if (error && typeof error === "object" && "name" in error) {
          const name = (error as { name: unknown }).name;
          if (name === "NotFoundError" || name === "DevicesNotFoundError") return "NotFound";
          if (name === "NotAllowedError" || name === "PermissionDeniedError") return "PermissionDenied";
          if (name === "NotReadableError" || name === "TrackStartError") return "DeviceInUse";
          return "Other";
        }
        return undefined;
      },
    },
  ),
  ConnectionErrorReason: { ServerUnreachable: "ServerUnreachable", WebSocket: "WebSocket", Timeout: "Timeout", NotAllowed: "NotAllowed" },
  ConnectionError: class ConnectionError extends Error {
    reason: string;
    constructor(reason: string) {
      super("connection error");
      this.name = "ConnectionError";
      this.reason = reason;
    }
    // Mirrors the real SDK's public static factories — its constructor is
    // protected, so tests (and production code) must go through these.
    static serverUnreachable(_message: string) {
      return new ConnectionError("ServerUnreachable");
    }
  },
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, getVoiceToken: vi.fn() };
});

const channel = { id: "c2", name: "salle", type: "voice", minRole: "member", position: 0, createdAt: "now" } as const;
const currentUser = { id: "u1", username: "theo", role: "member" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  roomHandlers.clear();
  localStorage.clear();
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
  return render(<ToastProvider><VoiceView channel={channel} currentUser={currentUser} /></ToastProvider>);
}

describe("VoiceView", () => {
  it("joins LiveKit and enables the microphone", async () => {
    renderView();
    await screen.findByText(/Connecté en tant que theo/);
    expect(api.getVoiceToken).toHaveBeenCalledWith("c2");
    expect(connect).toHaveBeenCalledWith("ws://livekit", "jwt");
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
  });

  it("mutes and leaves the room", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Couper le micro" }));
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
    await user.click(screen.getByRole("button", { name: "Quitter" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Rejoindre" })).toBeInTheDocument();
  });

  it("controls deafen, camera, and screen sharing", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Assourdir" }));
    expect(screen.getByRole("button", { name: "Rétablir le son" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Activer la caméra" }));
    expect(setCameraEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
    expect(screen.getByRole("button", { name: "Arrêter la caméra" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Partager l’écran" }));
    expect(setScreenShareEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
    expect(screen.getByRole("button", { name: "Arrêter le partage" })).toBeInTheDocument();
  });

  it("publishes screen sharing in 1080p60 game mode", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Réglages" }));
    await screen.findByRole("dialog", { name: "Voix & Vidéo" });
    await user.selectOptions(screen.getByLabelText("Partage d’écran"), "game");
    await user.click(screen.getByRole("button", { name: "Partager l’écran" }));

    expect(setScreenShareEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ resolution: expect.objectContaining({ width: 1920, height: 1080, frameRate: 60 }) }),
      expect.objectContaining({ screenShareEncoding: expect.objectContaining({ maxFramerate: 60 }) }),
    );
  });

  it("opens voice settings in a modal and closes it with Escape", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Réglages" }));
    expect(screen.getByRole("dialog", { name: "Voix & Vidéo" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Voix & Vidéo" })).not.toBeInTheDocument();
  });

  it("highlights the participant who is speaking", async () => {
    renderView();
    const participantName = await screen.findByText("theo (vous)");

    act(() => roomHandlers.get("activeSpeakersChanged")?.([{ identity: "u1", name: "theo" }]));

    expect(participantName.closest(".voice-participant")).toHaveClass("is-speaking");
    expect(screen.getByText("Parle")).toBeInTheDocument();
  });

  it("keeps the voice session connected while the view is hidden", async () => {
    const view = renderView();
    await screen.findByText(/Connecté en tant que theo/);

    view.rerender(
      <ToastProvider><VoiceView channel={channel} currentUser={currentUser} visible={false} /></ToastProvider>,
    );

    expect(view.container.querySelector(".voice-view")).not.toBeVisible();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("shows a reconnect banner while LiveKit reconnects and clears it once reconnected", async () => {
    renderView();
    await screen.findByText(/Connecté en tant que theo/);

    act(() => roomHandlers.get("reconnecting")?.());
    expect(screen.getByText(/Reconnexion en cours/)).toBeInTheDocument();

    act(() => roomHandlers.get("reconnected")?.());
    expect(screen.queryByText(/Reconnexion en cours/)).not.toBeInTheDocument();
  });

  it("shows a toast and returns to idle when the connection is lost after failed reconnection attempts", async () => {
    renderView();
    await screen.findByText(/Connecté en tant que theo/);

    act(() => roomHandlers.get("reconnecting")?.());
    act(() => roomHandlers.get("disconnected")?.());

    await screen.findByText("Connexion vocale perdue après plusieurs tentatives de reconnexion.");
    expect(screen.getByRole("button", { name: "Rejoindre" })).toBeInTheDocument();
  });

  it("does not show the reconnection-loss toast for a graceful disconnect", async () => {
    renderView();
    const user = userEvent.setup();
    await screen.findByText(/Connecté en tant que theo/);

    await user.click(screen.getByRole("button", { name: "Quitter" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalled());

    expect(screen.queryByText("Connexion vocale perdue après plusieurs tentatives de reconnexion.")).not.toBeInTheDocument();
  });

  it("shows a differentiated toast when the microphone permission is denied on join", async () => {
    setMicrophoneEnabled.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    renderView();
    await screen.findByText("Autorisation du microphone refusée. Vérifie les réglages de ton navigateur.");
    expect(screen.getByRole("button", { name: "Rejoindre" })).toBeInTheDocument();
  });

  it("shows a differentiated toast when no microphone is found on join", async () => {
    setMicrophoneEnabled.mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "NotFoundError" }));
    renderView();
    await screen.findByText("Aucun microphone détecté sur cet appareil.");
  });

  it("shows a network-loss toast when the initial connection is unreachable", async () => {
    connect.mockRejectedValueOnce(ConnectionError.serverUnreachable("no route to host"));
    renderView();
    await screen.findByText("Connexion réseau impossible. Vérifie ta connexion et réessaie.");
  });

  it("falls back to a generic join error for an unrelated failure", async () => {
    connect.mockRejectedValueOnce(new Error("boom"));
    renderView();
    await screen.findByText("Impossible d’activer le microphone.");
  });

  it("shows a differentiated toast when the camera permission is denied", async () => {
    renderView();
    const user = userEvent.setup();
    await screen.findByText(/Connecté en tant que theo/);
    setCameraEnabled.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await user.click(screen.getByRole("button", { name: "Activer la caméra" }));
    await screen.findByText("Autorisation de la caméra refusée. Vérifie les réglages de ton navigateur.");
  });

  it("shows a cancelled toast when the screen-share picker is dismissed", async () => {
    renderView();
    const user = userEvent.setup();
    await screen.findByText(/Connecté en tant que theo/);
    setScreenShareEnabled.mockRejectedValueOnce(Object.assign(new Error("cancel"), { name: "NotAllowedError" }));
    await user.click(screen.getByRole("button", { name: "Partager l’écran" }));
    await screen.findByText("Partage d’écran annulé.");
  });

  it("configures push-to-talk from voice settings", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Réglages" }));
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));

    expect(screen.getByRole("radio", { name: /Push-to-talk/ })).toHaveAttribute("aria-checked", "true");
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
  });
});
