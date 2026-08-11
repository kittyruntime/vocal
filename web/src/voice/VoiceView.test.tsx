import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast/ToastContext";
import { VoiceView } from "./VoiceView";
import * as api from "../api/client";
import type { CurrentUser } from "../api/client";
import { ConnectionError } from "livekit-client";
import { playAppSound } from "../audio/sounds";

const connect = vi.fn();
const disconnect = vi.fn();
const setMicrophoneEnabled = vi.fn();
const setCameraEnabled = vi.fn();
const setScreenShareEnabled = vi.fn();
const getTrackPublication = vi.fn();
const switchActiveDevice = vi.fn();
const setAttributes = vi.fn();
const roomHandlers = new Map<string, (...args: unknown[]) => void>();
const remoteParticipants = new Map<string, any>();

vi.mock("livekit-client", () => ({
  Room: class {
    static getLocalDevices() { return Promise.resolve([]); }
    remoteParticipants = remoteParticipants;
    connect = connect;
    disconnect = disconnect;
    switchActiveDevice = switchActiveDevice;
    localParticipant = { identity: "u1", name: "theo", attributes: {}, setMicrophoneEnabled, setCameraEnabled, setScreenShareEnabled, getTrackPublication, setAttributes };
    on(event: string, handler: (...args: unknown[]) => void) { roomHandlers.set(event, handler); return this; }
  },
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    LocalTrackUnpublished: "localTrackUnpublished",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    ConnectionQualityChanged: "connectionQualityChanged",
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    ParticipantPermissionsChanged: "participantPermissionsChanged",
    ParticipantAttributesChanged: "participantAttributesChanged",
    TrackMuted: "trackMuted",
    TrackUnmuted: "trackUnmuted",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    Disconnected: "disconnected",
  },
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor", Lost: "lost", Unknown: "unknown" },
  VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 },
  Track: {
    Kind: { Audio: "audio", Video: "video" },
    Source: { Camera: "camera", ScreenShare: "screen_share", Microphone: "microphone" },
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

vi.mock("../audio/sounds", () => ({ playAppSound: vi.fn() }));

const channel = { id: "c2", name: "salle", type: "voice", requiredCapability: null, position: 0, createdAt: "now" } as const;
const currentUser: CurrentUser = { id: "u1", username: "theo", capabilities: [] };

beforeEach(() => {
  vi.clearAllMocks();
  roomHandlers.clear();
  remoteParticipants.clear();
  localStorage.clear();
  vi.mocked(api.getVoiceToken).mockResolvedValue({ token: "jwt", url: "ws://livekit" });
  connect.mockResolvedValue(undefined);
  disconnect.mockResolvedValue(undefined);
  switchActiveDevice.mockResolvedValue(true);
  setAttributes.mockResolvedValue(undefined);
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

// Joining is never automatic (see VoiceView's removed auto-join effect) --
// this helper renders the view and clicks "Join" by default so existing
// tests that only care about the connected state don't each have to repeat
// that step. Pass `{ join: false }` to inspect the pre-join state itself.
async function renderView(
  extraProps: Partial<ComponentProps<typeof VoiceView>> = {},
  options: { join?: boolean } = {},
) {
  const view = render(<ToastProvider><VoiceView channel={channel} currentUser={currentUser} {...extraProps} /></ToastProvider>);
  if (options.join !== false) {
    await userEvent.setup().click(await screen.findByRole("button", { name: "Join" }));
  }
  return view;
}

describe("VoiceView", () => {
  it("hydrates participants and already-published tracks when joining an occupied room", async () => {
    const existingTrack = {
      sid: "track-existing",
      kind: "video",
      attach: vi.fn(() => document.createElement("video")),
      detach: vi.fn(() => []),
    };
    const participant = {
      identity: "u2",
      name: "alice",
      trackPublications: new Map([["track-existing", { source: "screen_share", track: existingTrack }]]),
    };
    remoteParticipants.set(participant.identity, participant);
    const onParticipantsChange = vi.fn();

    await renderView({ onParticipantsChange });

    await screen.findByRole("button", { name: "Mute microphone" });
    expect(onParticipantsChange).toHaveBeenLastCalledWith([
      { userId: "u1", username: "theo", avatarUrl: null, microphoneMuted: false, deafened: false },
      { userId: "u2", username: "alice", avatarUrl: null, microphoneMuted: true, deafened: false },
    ]);
    expect(screen.getByLabelText("Channel videos").querySelectorAll(".screen-share")).toHaveLength(1);
    expect(existingTrack.attach).toHaveBeenCalledOnce();
  });

  it("joins LiveKit and enables the microphone", async () => {
    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });
    expect(api.getVoiceToken).toHaveBeenCalledWith("c2");
    expect(connect).toHaveBeenCalledWith("ws://livekit", "jwt");
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
  });

  it("shows remote microphone and sound status and refreshes it from LiveKit events", async () => {
    const microphone = { source: "microphone", isMuted: true };
    const participant = {
      identity: "u2",
      name: "alice",
      attributes: { "vocal.deafened": "true" },
      getTrackPublication: vi.fn(() => microphone),
      trackPublications: new Map(),
    };
    remoteParticipants.set(participant.identity, participant);

    await renderView();
    expect(await screen.findByLabelText("alice: microphone muted, sound muted")).toBeInTheDocument();

    microphone.isMuted = false;
    participant.attributes["vocal.deafened"] = "false";
    act(() => roomHandlers.get("trackUnmuted")?.());
    expect(screen.getByLabelText("alice: microphone on")).toBeInTheDocument();
  });

  it("mutes and leaves the room", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mute microphone" }));
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("plays a sound when toggling the microphone", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mute microphone" }));
    expect(playAppSound).toHaveBeenCalledWith("muteToggle");
  });

  it("plays a sound when a moderator force-mutes the local participant", async () => {
    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });
    const handler = roomHandlers.get("participantPermissionsChanged");
    handler?.({ canPublish: true }, { isLocal: true, permissions: { canPublish: false } });
    expect(playAppSound).toHaveBeenCalledWith("forceMuted");
  });

  it("ignores a permission change on a remote participant", async () => {
    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });
    const handler = roomHandlers.get("participantPermissionsChanged");
    handler?.({ canPublish: true }, { isLocal: false, permissions: { canPublish: false } });
    expect(playAppSound).not.toHaveBeenCalledWith("forceMuted");
  });

  it("controls deafen, camera, and screen sharing", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Deafen" }));
    expect(screen.getByRole("button", { name: "Undeafen" })).toHaveAttribute("aria-pressed", "true");
    expect(setAttributes).toHaveBeenLastCalledWith({ "vocal.deafened": "true" });

    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    expect(setCameraEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
    expect(screen.getByRole("button", { name: "Stop camera" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Share screen" }));
    expect(setScreenShareEnabled).toHaveBeenCalledWith(true, expect.any(Object), expect.any(Object));
    expect(setScreenShareEnabled).toHaveBeenCalledWith(true, expect.objectContaining({ audio: true }), expect.any(Object));
    expect(playAppSound).toHaveBeenCalledWith("screenShare");
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
  });

  it("shows a fullscreen button on a local video tile and requests fullscreen on click", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Turn on camera" }));
    const fullscreenButton = await screen.findByRole("button", { name: "Enter fullscreen" });
    await user.click(fullscreenButton);
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled();
  });

  it("switches to an exit-fullscreen affordance once fullscreen is active, and can exit", async () => {
    await renderView();
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
    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });
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
    await renderView();
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
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Voice & Video" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Voice & Video" })).not.toBeInTheDocument();
  });

  it("highlights the participant who is speaking", async () => {
    await renderView();
    const participantName = await screen.findByText("theo (you)");

    act(() => roomHandlers.get("activeSpeakersChanged")?.([{ identity: "u1", name: "theo" }]));

    expect(participantName.closest(".voice-participant")).toHaveClass("is-speaking");
    expect(screen.queryByText("Speaking")).not.toBeInTheDocument();
    expect(screen.queryByText("Listening")).not.toBeInTheDocument();
  });

  it("keeps the voice session connected while the view is hidden", async () => {
    const view = await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });

    view.rerender(
      <ToastProvider><VoiceView channel={channel} currentUser={currentUser} visible={false} /></ToastProvider>,
    );

    expect(view.container.querySelector(".voice-view")).not.toBeVisible();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("shows a reconnect banner while LiveKit reconnects and clears it once reconnected", async () => {
    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });

    act(() => roomHandlers.get("reconnecting")?.());
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();

    act(() => roomHandlers.get("reconnected")?.());
    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
  });

  it("shows a toast and returns to idle when the connection is lost after failed reconnection attempts", async () => {
    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });

    act(() => roomHandlers.get("reconnecting")?.());
    act(() => roomHandlers.get("disconnected")?.());

    await screen.findByText("Voice connection lost after several reconnection attempts.");
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("does not show the reconnection-loss toast for a graceful disconnect", async () => {
    await renderView();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Mute microphone" });

    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalled());

    expect(screen.queryByText("Voice connection lost after several reconnection attempts.")).not.toBeInTheDocument();
  });

  it("shows a differentiated toast when the microphone permission is denied on join", async () => {
    setMicrophoneEnabled.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await renderView();
    await screen.findByText("Microphone permission denied. Check your browser settings.");
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("shows a differentiated toast when no microphone is found on join", async () => {
    setMicrophoneEnabled.mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "NotFoundError" }));
    await renderView();
    await screen.findByText("No microphone detected on this device.");
  });

  it("shows a network-loss toast when the initial connection is unreachable", async () => {
    connect.mockRejectedValueOnce(ConnectionError.serverUnreachable("no route to host"));
    await renderView();
    await screen.findByText("Network connection failed. Check your connection and try again.");
  });

  it("falls back to a generic join error for an unrelated failure", async () => {
    connect.mockRejectedValueOnce(new Error("boom"));
    await renderView();
    await screen.findByText("Could not enable the microphone.");
  });

  it("shows a differentiated toast when the camera permission is denied", async () => {
    await renderView();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Mute microphone" });
    setCameraEnabled.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    await screen.findByText("Camera permission denied. Check your browser settings.");
  });

  it("shows a cancelled toast when the screen-share picker is dismissed", async () => {
    await renderView();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Mute microphone" });
    setScreenShareEnabled.mockRejectedValueOnce(Object.assign(new Error("cancel"), { name: "NotAllowedError" }));
    await user.click(screen.getByRole("button", { name: "Share screen" }));
    await screen.findByText("Screen share cancelled.");
    expect(playAppSound).not.toHaveBeenCalledWith("screenShare");
  });

  it("configures push-to-talk from voice settings", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));

    expect(screen.getByRole("radio", { name: /Push-to-talk/ })).toHaveAttribute("aria-checked", "true");
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
  });

  it("reports active speakers to the parent and clears them on leave", async () => {
    const onSpeakingChange = vi.fn();
    await renderView({ onSpeakingChange });
    await screen.findByRole("button", { name: "Mute microphone" });

    act(() => roomHandlers.get("activeSpeakersChanged")?.([{ identity: "u2", name: "alice" }]));
    expect(onSpeakingChange).toHaveBeenCalledWith(["u2"]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(onSpeakingChange).toHaveBeenLastCalledWith([]));
  });

  it("reports self-presence to the parent on join and on leave", async () => {
    const onSelfPresenceChange = vi.fn();
    await renderView({ onSelfPresenceChange });
    await screen.findByRole("button", { name: "Mute microphone" });
    expect(onSelfPresenceChange).toHaveBeenLastCalledWith(true);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(onSelfPresenceChange).toHaveBeenLastCalledWith(false));
  });

  it("clears self-presence when disconnected involuntarily", async () => {
    const onSelfPresenceChange = vi.fn();
    await renderView({ onSelfPresenceChange });
    await screen.findByRole("button", { name: "Mute microphone" });
    onSelfPresenceChange.mockClear();

    act(() => roomHandlers.get("disconnected")?.());
    await waitFor(() => expect(onSelfPresenceChange).toHaveBeenCalledWith(false));
  });

  it("cleanly leaves the old channel when switching directly to another voice channel, without auto-joining the new one", async () => {
    const onSelfPresenceChange = vi.fn();
    const view = await renderView({ onSelfPresenceChange });
    await screen.findByRole("button", { name: "Mute microphone" });
    expect(connect).toHaveBeenCalledTimes(1);

    const otherChannel = { ...channel, id: "c3", name: "autre" };
    view.rerender(
      <ToastProvider>
        <VoiceView channel={otherChannel} currentUser={currentUser} onSelfPresenceChange={onSelfPresenceChange} />
      </ToastProvider>,
    );

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onSelfPresenceChange).toHaveBeenCalledWith(false);
    await screen.findByRole("button", { name: "Join" });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(api.getVoiceToken).not.toHaveBeenCalledWith("c3");
  });

  it("never joins automatically -- selecting a voice channel requires an explicit Join click", async () => {
    await renderView({}, { join: false });
    await screen.findByRole("button", { name: "Join" });
    expect(connect).not.toHaveBeenCalled();
    expect(api.getVoiceToken).not.toHaveBeenCalled();
  });

  it("shows a connection-quality badge driven only by the local participant's quality", async () => {
    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });

    act(() => roomHandlers.get("connectionQualityChanged")?.("poor", { identity: "u2", isLocal: false }));
    expect(screen.queryByText("Poor")).not.toBeInTheDocument();

    act(() => roomHandlers.get("connectionQualityChanged")?.("poor", { identity: "u1", isLocal: true }));
    expect(await screen.findByText("Poor")).toBeInTheDocument();

    act(() => roomHandlers.get("connectionQualityChanged")?.("lost", { identity: "u1", isLocal: true }));
    expect(await screen.findByText("Lost")).toBeInTheDocument();

    act(() => roomHandlers.get("connectionQualityChanged")?.("good", { identity: "u1", isLocal: true }));
    expect(await screen.findByText("Good")).toBeInTheDocument();
  });

  it("downgrades remote video to LOW on poor connection quality and restores HIGH after three consecutive good samples", async () => {
    const setVideoQuality = vi.fn();
    remoteParticipants.set("u2", {
      identity: "u2",
      name: "alice",
      trackPublications: new Map(),
      videoTrackPublications: new Map([["pub1", { setVideoQuality }]]),
    });

    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });

    act(() => roomHandlers.get("connectionQualityChanged")?.("poor", { identity: "u1", isLocal: true }));
    expect(setVideoQuality).toHaveBeenLastCalledWith(0);

    setVideoQuality.mockClear();
    act(() => roomHandlers.get("connectionQualityChanged")?.("good", { identity: "u1", isLocal: true }));
    act(() => roomHandlers.get("connectionQualityChanged")?.("good", { identity: "u1", isLocal: true }));
    expect(setVideoQuality).not.toHaveBeenCalled();

    act(() => roomHandlers.get("connectionQualityChanged")?.("good", { identity: "u1", isLocal: true }));
    expect(setVideoQuality).toHaveBeenLastCalledWith(2);
  });

  it("starts a newly subscribed remote video track at LOW quality while the call is already downgraded", async () => {
    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });
    act(() => roomHandlers.get("connectionQualityChanged")?.("poor", { identity: "u1", isLocal: true }));

    const setVideoQuality = vi.fn();
    const remoteTrack = { kind: "video", sid: "t1", attach: vi.fn(() => document.createElement("video")), detach: vi.fn(() => []) };
    const publication = { source: "camera", setVideoQuality };
    const participant = { identity: "u2", name: "alice" };
    act(() => roomHandlers.get("trackSubscribed")?.(remoteTrack, publication, participant));

    expect(setVideoQuality).toHaveBeenCalledWith(0);
  });

  it("samples RTT and packet loss once connected and surfaces them in the quality badge tooltip", async () => {
    const fakeReport = new Map<string, unknown>([
      ["cp1", { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.042 }],
      ["ri1", { type: "remote-inbound-rtp", fractionLost: 0.02 }],
    ]);
    getTrackPublication.mockReturnValue({ track: { getRTCStatsReport: vi.fn().mockResolvedValue(fakeReport) } });

    await renderView();
    await screen.findByRole("button", { name: "Mute microphone" });
    act(() => roomHandlers.get("connectionQualityChanged")?.("good", { identity: "u1", isLocal: true }));

    const badge = await screen.findByText("Good");
    await waitFor(() => expect(badge).toHaveAttribute("title", "42 ms · 2% loss"));
  });
});
