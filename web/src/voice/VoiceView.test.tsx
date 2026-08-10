import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast/ToastContext";
import { VoiceView } from "./VoiceView";
import * as api from "../api/client";
import type { CurrentUser } from "../api/client";
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

const channel = { id: "c2", name: "salle", type: "voice", requiredCapability: null, position: 0, createdAt: "now" } as const;
const currentUser: CurrentUser = { id: "u1", username: "theo", capabilities: [] };

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
  HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document, "fullscreenElement", { value: null, writable: true, configurable: true });
});

function renderView(extraProps: Partial<ComponentProps<typeof VoiceView>> = {}) {
  return render(<ToastProvider><VoiceView channel={channel} currentUser={currentUser} {...extraProps} /></ToastProvider>);
}

describe("VoiceView", () => {
  it("joins LiveKit and enables the microphone", async () => {
    renderView();
    await screen.findByText(/Connected as theo/);
    expect(api.getVoiceToken).toHaveBeenCalledWith("c2");
    expect(connect).toHaveBeenCalledWith("ws://livekit", "jwt");
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
  });

  it("mutes and leaves the room", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mute microphone" }));
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("controls deafen, camera, and screen sharing", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Deafen" }));
    expect(screen.getByRole("button", { name: "Undeafen" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    expect(setCameraEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
    expect(screen.getByRole("button", { name: "Stop camera" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Share screen" }));
    expect(setScreenShareEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
  });

  it("shows a fullscreen button on a local video tile and requests fullscreen on click", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Turn on camera" }));
    const fullscreenButton = await screen.findByRole("button", { name: "Enter fullscreen" });
    await user.click(fullscreenButton);
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled();
  });

  it("switches to an exit-fullscreen affordance once fullscreen is active, and can exit", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Turn on camera" }));
    const fullscreenButton = await screen.findByRole("button", { name: "Enter fullscreen" });
    const tile = fullscreenButton.parentElement;

    Object.defineProperty(document, "fullscreenElement", { value: tile, writable: true, configurable: true });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));

    const exitButton = await screen.findByRole("button", { name: "Exit fullscreen" });
    await user.click(exitButton);
    expect(document.exitFullscreen).toHaveBeenCalled();
  });

  it("shows a fullscreen button on remote video tiles too", async () => {
    renderView();
    await screen.findByText(/Connected as theo/);
    const remoteTrack = {
      kind: "video",
      sid: "remote-track-1",
      attach: vi.fn(() => document.createElement("video")),
      detach: vi.fn(() => []),
    };
    const publication = { source: "camera" };
    const participant = { identity: "u2", name: "alice" };
    act(() => roomHandlers.get("trackSubscribed")?.(remoteTrack, publication, participant));

    expect(await screen.findByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
  });

  it("publishes screen sharing in 1080p60 game mode", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog", { name: "Voice & Video" });
    await user.selectOptions(screen.getByLabelText("Screen share"), "game");
    await user.click(screen.getByRole("button", { name: "Share screen" }));

    expect(setScreenShareEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ resolution: expect.objectContaining({ width: 1920, height: 1080, frameRate: 60 }) }),
      expect.objectContaining({ screenShareEncoding: expect.objectContaining({ maxFramerate: 60 }) }),
    );
  });

  it("opens voice settings in a modal and closes it with Escape", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Voice & Video" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Voice & Video" })).not.toBeInTheDocument();
  });

  it("highlights the participant who is speaking", async () => {
    renderView();
    const participantName = await screen.findByText("theo (you)");

    act(() => roomHandlers.get("activeSpeakersChanged")?.([{ identity: "u1", name: "theo" }]));

    expect(participantName.closest(".voice-participant")).toHaveClass("is-speaking");
    expect(screen.queryByText("Speaking")).not.toBeInTheDocument();
    expect(screen.queryByText("Listening")).not.toBeInTheDocument();
  });

  it("keeps the voice session connected while the view is hidden", async () => {
    const view = renderView();
    await screen.findByText(/Connected as theo/);

    view.rerender(
      <ToastProvider><VoiceView channel={channel} currentUser={currentUser} visible={false} /></ToastProvider>,
    );

    expect(view.container.querySelector(".voice-view")).not.toBeVisible();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("shows a reconnect banner while LiveKit reconnects and clears it once reconnected", async () => {
    renderView();
    await screen.findByText(/Connected as theo/);

    act(() => roomHandlers.get("reconnecting")?.());
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();

    act(() => roomHandlers.get("reconnected")?.());
    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
  });

  it("shows a toast and returns to idle when the connection is lost after failed reconnection attempts", async () => {
    renderView();
    await screen.findByText(/Connected as theo/);

    act(() => roomHandlers.get("reconnecting")?.());
    act(() => roomHandlers.get("disconnected")?.());

    await screen.findByText("Voice connection lost after several reconnection attempts.");
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("does not show the reconnection-loss toast for a graceful disconnect", async () => {
    renderView();
    const user = userEvent.setup();
    await screen.findByText(/Connected as theo/);

    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalled());

    expect(screen.queryByText("Voice connection lost after several reconnection attempts.")).not.toBeInTheDocument();
  });

  it("shows a differentiated toast when the microphone permission is denied on join", async () => {
    setMicrophoneEnabled.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    renderView();
    await screen.findByText("Microphone permission denied. Check your browser settings.");
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("shows a differentiated toast when no microphone is found on join", async () => {
    setMicrophoneEnabled.mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "NotFoundError" }));
    renderView();
    await screen.findByText("No microphone detected on this device.");
  });

  it("shows a network-loss toast when the initial connection is unreachable", async () => {
    connect.mockRejectedValueOnce(ConnectionError.serverUnreachable("no route to host"));
    renderView();
    await screen.findByText("Network connection failed. Check your connection and try again.");
  });

  it("falls back to a generic join error for an unrelated failure", async () => {
    connect.mockRejectedValueOnce(new Error("boom"));
    renderView();
    await screen.findByText("Could not enable the microphone.");
  });

  it("shows a differentiated toast when the camera permission is denied", async () => {
    renderView();
    const user = userEvent.setup();
    await screen.findByText(/Connected as theo/);
    setCameraEnabled.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    await screen.findByText("Camera permission denied. Check your browser settings.");
  });

  it("shows a cancelled toast when the screen-share picker is dismissed", async () => {
    renderView();
    const user = userEvent.setup();
    await screen.findByText(/Connected as theo/);
    setScreenShareEnabled.mockRejectedValueOnce(Object.assign(new Error("cancel"), { name: "NotAllowedError" }));
    await user.click(screen.getByRole("button", { name: "Share screen" }));
    await screen.findByText("Screen share cancelled.");
  });

  it("configures push-to-talk from voice settings", async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));

    expect(screen.getByRole("radio", { name: /Push-to-talk/ })).toHaveAttribute("aria-checked", "true");
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
  });

  it("reports active speakers to the parent and clears them on leave", async () => {
    const onSpeakingChange = vi.fn();
    renderView({ onSpeakingChange });
    await screen.findByText(/Connected as theo/);

    act(() => roomHandlers.get("activeSpeakersChanged")?.([{ identity: "u2", name: "alice" }]));
    expect(onSpeakingChange).toHaveBeenCalledWith(["u2"]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(onSpeakingChange).toHaveBeenLastCalledWith([]));
  });

  it("reports self-presence to the parent on join and on leave", async () => {
    const onSelfPresenceChange = vi.fn();
    renderView({ onSelfPresenceChange });
    await screen.findByText(/Connected as theo/);
    expect(onSelfPresenceChange).toHaveBeenLastCalledWith(true);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(onSelfPresenceChange).toHaveBeenLastCalledWith(false));
  });

  it("clears self-presence when disconnected involuntarily", async () => {
    const onSelfPresenceChange = vi.fn();
    renderView({ onSelfPresenceChange });
    await screen.findByText(/Connected as theo/);
    onSelfPresenceChange.mockClear();

    act(() => roomHandlers.get("disconnected")?.());
    await waitFor(() => expect(onSelfPresenceChange).toHaveBeenCalledWith(false));
  });

  it("re-joins the new channel when switching directly between two voice channels while connected", async () => {
    const onSelfPresenceChange = vi.fn();
    const view = renderView({ onSelfPresenceChange });
    await screen.findByText(/Connected as theo/);
    expect(connect).toHaveBeenCalledTimes(1);

    const otherChannel = { ...channel, id: "c3", name: "autre" };
    view.rerender(
      <ToastProvider>
        <VoiceView channel={otherChannel} currentUser={currentUser} onSelfPresenceChange={onSelfPresenceChange} />
      </ToastProvider>,
    );

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onSelfPresenceChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(api.getVoiceToken).toHaveBeenCalledWith("c3"));
    await screen.findByText(/Connected as theo/);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
