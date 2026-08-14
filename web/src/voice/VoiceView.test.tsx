import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const createScreenTracks = vi.fn();
const publishTrack = vi.fn();
const getTrackPublication = vi.fn();
const unpublishTrack = vi.fn();
const getLocalDevices = vi.fn();
const switchActiveDevice = vi.fn();
const setAttributes = vi.fn();
const roomHandlers = new Map<string, (...args: unknown[]) => void>();
const remoteParticipants = new Map<string, any>();
type MockLocalTrack = {
  kind: "audio" | "video";
  source: string;
  captureOptions: unknown;
  publishOptions: unknown;
  attach: () => HTMLMediaElement;
  detach: () => HTMLMediaElement[];
  stop: () => void;
  getProcessor: () => unknown;
  stopProcessor: () => Promise<void>;
  setProcessor: (next: unknown) => Promise<void>;
  getRTCStatsReport: () => Promise<undefined>;
};
type MockLocalPublication = {
  source: string;
  isMuted: boolean;
  track?: MockLocalTrack;
  audioTrack?: MockLocalTrack;
};
const localPublications = new Map<string, MockLocalPublication>();

function createMockLocalTrack(kind: "audio" | "video", source: string, captureOptions: unknown, publishOptions: unknown): MockLocalTrack {
  let processor: unknown;
  return {
    kind,
    source,
    captureOptions,
    publishOptions,
    attach: vi.fn(() => document.createElement(kind === "video" ? "video" : "audio")),
    detach: vi.fn(() => []),
    stop: vi.fn(),
    getProcessor: vi.fn(() => processor),
    stopProcessor: vi.fn(async () => { processor = undefined; }),
    setProcessor: vi.fn(async (next: unknown) => { processor = next; }),
    getRTCStatsReport: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock("livekit-client", () => ({
  Room: class {
    static getLocalDevices(...args: unknown[]) { return getLocalDevices(...args); }
    remoteParticipants = remoteParticipants;
    connect = connect;
    disconnect = disconnect;
    switchActiveDevice = switchActiveDevice;
    localParticipant = { identity: "u1", name: "theo", attributes: {}, setMicrophoneEnabled, setCameraEnabled, setScreenShareEnabled, createScreenTracks, publishTrack, getTrackPublication, unpublishTrack, setAttributes };
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
    Source: { Camera: "camera", ScreenShare: "screen_share", ScreenShareAudio: "screen_share_audio", Microphone: "microphone" },
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
  roomHandlers.clear();
  remoteParticipants.clear();
  localPublications.clear();
  localStorage.clear();
  vi.mocked(api.getVoiceToken).mockResolvedValue({ token: "jwt", url: "ws://livekit" });
  connect.mockResolvedValue(undefined);
  disconnect.mockResolvedValue(undefined);
  getLocalDevices.mockResolvedValue([]);
  switchActiveDevice.mockResolvedValue(true);
  setAttributes.mockResolvedValue(undefined);
  setMicrophoneEnabled.mockImplementation(async (enabled: boolean, captureOptions: unknown, publishOptions: unknown) => {
    let publication = localPublications.get("microphone");
    if (enabled) {
      if (publication) {
        publication.isMuted = false;
        return publication;
      }
      const track = createMockLocalTrack("audio", "microphone", captureOptions, publishOptions);
      publication = { source: "microphone", isMuted: false, track, audioTrack: track };
      localPublications.set("microphone", publication);
      return publication;
    }
    if (publication) publication.isMuted = true;
    return publication;
  });
  setCameraEnabled.mockImplementation(async (enabled: boolean, captureOptions: unknown, publishOptions: unknown) => {
    let publication = localPublications.get("camera");
    if (enabled) {
      if (publication) {
        publication.isMuted = false;
        return publication;
      }
      const track = createMockLocalTrack("video", "camera", captureOptions, publishOptions);
      publication = { source: "camera", isMuted: false, track };
      localPublications.set("camera", publication);
      return publication;
    }
    if (publication) publication.isMuted = true;
    return publication;
  });
  getTrackPublication.mockImplementation((source: string) => localPublications.get(source));
  unpublishTrack.mockImplementation(async (track: MockLocalTrack, stopOnUnpublish = true) => {
    const publication = [...localPublications.values()].find((candidate) => candidate.track === track);
    if (!publication) return undefined;
    if (stopOnUnpublish) track.stop();
    localPublications.delete(publication.source);
    publication.track = undefined;
    publication.audioTrack = undefined;
    return publication;
  });
  const videoTrack = {
    kind: "video",
    attach: vi.fn(() => document.createElement("video")),
    detach: vi.fn(() => []),
    stop: vi.fn(),
  };
  const screenAudioTrack = { kind: "audio", stop: vi.fn() };
  setScreenShareEnabled.mockResolvedValue({ track: videoTrack });
  createScreenTracks.mockResolvedValue([videoTrack, screenAudioTrack]);
  publishTrack.mockImplementation((track) => Promise.resolve({ track }));
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
    expect(createScreenTracks).toHaveBeenCalledWith(expect.objectContaining({ audio: true, systemAudio: "include" }));
    expect(publishTrack).toHaveBeenCalledTimes(2);
    expect(playAppSound).toHaveBeenCalledWith("screenShare");
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
  });

  it("keeps the Advanced mode switch inside the padded settings content", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Voice & Video" });
    const content = dialog.querySelector<HTMLElement>(".voice-settings-content");
    const advancedSection = screen.getByRole("switch", { name: "Advanced mode" }).closest<HTMLElement>(".settings-section");

    expect(content).not.toBeNull();
    expect(advancedSection).not.toBeNull();
    expect(content).toContainElement(advancedSection);
    expect(content?.firstElementChild).toBe(advancedSection);
  });

  it("explains that device choices load after joining when settings open before a room", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Device choices load after you join the voice channel.")).toBeInTheDocument();
  });

  it("reports an empty device enumeration after connecting instead of showing the pre-join hint", async () => {
    await renderView();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Mute microphone" });

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("No audio or video devices were found.")).toBeInTheDocument();
    expect(screen.queryByText("Device choices load after you join the voice channel.")).not.toBeInTheDocument();
  });

  it("clears enumerated devices after leaving a joined room", async () => {
    getLocalDevices.mockResolvedValue([{
      deviceId: "mic-1",
      groupId: "group-1",
      kind: "audioinput",
      label: "Studio microphone",
      toJSON: () => ({}),
    } satisfies MediaDeviceInfo]);
    await renderView();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Mute microphone" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Microphone")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    await user.click(screen.getByRole("button", { name: "Leave" }));
    await screen.findByRole("button", { name: "Join" });
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Device choices load after you join the voice channel.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Microphone")).not.toBeInTheDocument();
  });

  it("hides the screen share audio quality selector until advanced mode is turned on", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog", { name: "Voice & Video" });
    expect(screen.queryByLabelText("Screen share audio")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    expect(screen.getByLabelText("Screen share audio")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    expect(screen.queryByLabelText("Screen share audio")).not.toBeInTheDocument();
  });

  it("persists advanced mode to localStorage", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog", { name: "Voice & Video" });
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));

    const stored = JSON.parse(window.localStorage.getItem("vocal.voice-settings.v1") ?? "{}");
    expect(stored.advancedMode).toBe(true);
  });

  it("offers and preserves Custom only through Advanced mode", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("option", { name: "Custom" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    expect(screen.getAllByRole("option", { name: "Custom" })).toHaveLength(4);
    await user.selectOptions(screen.getByLabelText("Webcam"), "custom");
    expect(screen.getByRole("spinbutton", { name: "Webcam width (px)" })).toHaveValue(1280);
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    expect(screen.queryByRole("spinbutton", { name: "Webcam width (px)" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Webcam")).toHaveValue("custom");
    expect(screen.getAllByRole("option", { name: "Custom" })).toHaveLength(1);
  });

  it("renders every custom stream field when its Custom option is selected", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Audio"), "custom");
    await user.selectOptions(screen.getByLabelText("Webcam"), "custom");
    await user.selectOptions(screen.getByLabelText("Screen share"), "custom");
    await user.selectOptions(screen.getByLabelText("Screen share audio"), "custom");

    for (const label of [
      "Microphone bitrate (kb/s)",
      "Webcam width (px)",
      "Webcam height (px)",
      "Webcam frame rate (fps)",
      "Webcam bitrate (kb/s)",
      "Screen width (px)",
      "Screen height (px)",
      "Screen frame rate (fps)",
      "Screen bitrate (kb/s)",
      "Screen audio bitrate (kb/s)",
    ]) {
      expect(screen.getByRole("spinbutton", { name: label })).toBeInTheDocument();
    }
  });

  it("persists valid custom webcam values", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Webcam"), "custom");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Webcam bitrate (kb/s)" }), { target: { value: "4200" } });
    expect(JSON.parse(localStorage.getItem("vocal.voice-settings.v1") ?? "{}").customCamera.bitrateKbps).toBe(4200);
  });

  it("passes exact custom settings to every LiveKit activation boundary", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Audio"), "custom");
    await user.selectOptions(screen.getByLabelText("Webcam"), "custom");
    await user.selectOptions(screen.getByLabelText("Screen share"), "custom");
    await user.selectOptions(screen.getByLabelText("Screen share audio"), "custom");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Microphone bitrate (kb/s)" }), { target: { value: "72" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Webcam width (px)" }), { target: { value: "1920" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Webcam height (px)" }), { target: { value: "1080" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Webcam frame rate (fps)" }), { target: { value: "48" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Webcam bitrate (kb/s)" }), { target: { value: "7500" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Screen width (px)" }), { target: { value: "2560" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Screen height (px)" }), { target: { value: "1440" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Screen frame rate (fps)" }), { target: { value: "30" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Screen bitrate (kb/s)" }), { target: { value: "12000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Screen audio bitrate (kb/s)" }), { target: { value: "160" } });
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Mute microphone" });
    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    await user.click(screen.getByRole("button", { name: "Share screen" }));

    expect(setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ channelCount: 1 }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 72_000 }) }),
    );
    expect(setCameraEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ resolution: { width: 1920, height: 1080, frameRate: 48 } }),
      expect.objectContaining({ videoEncoding: { maxBitrate: 7_500_000, maxFramerate: 48 }, simulcast: true }),
    );
    expect(createScreenTracks).toHaveBeenCalledWith(expect.objectContaining({
      audio: true,
      resolution: { width: 2560, height: 1440, frameRate: 30 },
      contentHint: "motion",
    }));
    expect(publishTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "video" }),
      expect.objectContaining({ screenShareEncoding: { maxBitrate: 12_000_000, maxFramerate: 30 } }),
    );
    expect(publishTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "audio" }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 160_000 }), forceStereo: true }),
    );
  });

  it("uses an edited custom microphone bitrate on the next push-to-talk press", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Audio"), "custom");
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Mute microphone" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Microphone bitrate (kb/s)" }), { target: { value: "88" } });
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    setMicrophoneEnabled.mockClear();

    fireEvent.keyDown(window, { code: "Space", key: " " });

    await waitFor(() => expect(setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ channelCount: 1 }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 88_000 }) }),
    ));
    fireEvent.keyUp(window, { code: "Space", key: " " });
  });

  it("recreates a stale microphone publication once on the next push-to-talk press", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Audio"), "custom");
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Hold Space" });

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "You're talking…" });
    const firstPublication = localPublications.get("microphone");
    const firstTrack = firstPublication?.track;
    expect(firstTrack?.publishOptions).toMatchObject({ audioPreset: { maxBitrate: 48_000 } });
    fireEvent.keyUp(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "Hold Space" });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Microphone bitrate (kb/s)" }), { target: { value: "88" } });
    expect(localPublications.get("microphone")?.track).toBe(firstTrack);
    expect(firstTrack?.stop).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await waitFor(() => expect(localPublications.get("microphone")?.track?.publishOptions).toMatchObject({
      audioPreset: { maxBitrate: 88_000 },
    }));
    const refreshedTrack = localPublications.get("microphone")?.track;
    expect(refreshedTrack).not.toBe(firstTrack);
    expect(unpublishTrack).toHaveBeenCalledWith(firstTrack, true);
    expect(firstTrack?.stop).toHaveBeenCalledOnce();
    fireEvent.keyUp(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "Hold Space" });

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "You're talking…" });
    expect(localPublications.get("microphone")?.track).toBe(refreshedTrack);
    expect(unpublishTrack).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(window, { code: "Space", key: " " });
  });

  it("stays muted when push-to-talk is released while a stale publication is rebuilding", async () => {
    const onSelfMediaStatusChange = vi.fn();
    await renderView({ onSelfMediaStatusChange }, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Audio"), "custom");
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Hold Space" });
    fireEvent.keyDown(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "You're talking…" });
    fireEvent.keyUp(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "Hold Space" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Microphone bitrate (kb/s)" }), { target: { value: "88" } });
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    let finishUnpublish!: () => void;
    const pendingUnpublish = new Promise<void>((resolve) => { finishUnpublish = resolve; });
    unpublishTrack.mockImplementationOnce(async (track: MockLocalTrack, stopOnUnpublish = true) => {
      const publication = localPublications.get("microphone");
      if (stopOnUnpublish) track.stop();
      if (publication) {
        localPublications.delete("microphone");
        publication.track = undefined;
        publication.audioTrack = undefined;
      }
      await pendingUnpublish;
      return publication;
    });
    setMicrophoneEnabled.mockClear();
    onSelfMediaStatusChange.mockClear();

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await waitFor(() => expect(unpublishTrack).toHaveBeenCalledOnce());
    fireEvent.keyUp(window, { code: "Space", key: " " });
    await act(async () => {
      finishUnpublish();
      await pendingUnpublish;
    });

    expect(localPublications.get("microphone")?.isMuted ?? true).toBe(true);
    expect(screen.getByRole("button", { name: "Hold Space" })).toBeInTheDocument();
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
    expect(setMicrophoneEnabled.mock.calls.filter(([enabled]) => enabled)).toHaveLength(0);
    expect(onSelfMediaStatusChange).toHaveBeenLastCalledWith("c2", { microphoneMuted: true, deafened: false });
    expect(onSelfMediaStatusChange).not.toHaveBeenCalledWith("c2", { microphoneMuted: false, deafened: false });
  });

  it("keeps held push-to-talk active through a valid edit and applies it after release", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Audio"), "custom");
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Hold Space" });
    await user.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "You're talking…" });
    const originalTrack = localPublications.get("microphone")?.track;
    setMicrophoneEnabled.mockClear();
    const bitrate = screen.getByRole("spinbutton", { name: "Microphone bitrate (kb/s)" });
    fireEvent.focus(bitrate);
    fireEvent.change(bitrate, { target: { value: "88" } });
    await act(async () => undefined);

    expect(screen.getByRole("button", { name: "You're talking…" })).toBeInTheDocument();
    expect(setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(localPublications.get("microphone")?.track).toBe(originalTrack);
    expect(unpublishTrack).not.toHaveBeenCalled();

    fireEvent.keyUp(bitrate, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "Hold Space" });
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await waitFor(() => expect(localPublications.get("microphone")?.track?.publishOptions).toMatchObject({
      audioPreset: { maxBitrate: 88_000 },
    }));
    expect(localPublications.get("microphone")?.track).not.toBe(originalTrack);
    expect(unpublishTrack).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(window, { code: "Space", key: " " });
  });

  it("releases held push-to-talk from an invalid focused draft without rebuilding next press", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Audio"), "custom");
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Hold Space" });
    await user.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "You're talking…" });
    const originalTrack = localPublications.get("microphone")?.track;
    setMicrophoneEnabled.mockClear();
    const bitrate = screen.getByRole("spinbutton", { name: "Microphone bitrate (kb/s)" });
    fireEvent.focus(bitrate);
    fireEvent.change(bitrate, { target: { value: "" } });
    await act(async () => undefined);
    expect(screen.getByRole("button", { name: "You're talking…" })).toBeInTheDocument();
    expect(setMicrophoneEnabled).not.toHaveBeenCalled();

    fireEvent.keyUp(bitrate, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "Hold Space" });
    fireEvent.blur(bitrate);
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    unpublishTrack.mockClear();

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await screen.findByRole("button", { name: "You're talking…" });
    expect(localPublications.get("microphone")?.track).toBe(originalTrack);
    expect(localPublications.get("microphone")?.track?.publishOptions).toMatchObject({ audioPreset: { maxBitrate: 48_000 } });
    expect(unpublishTrack).not.toHaveBeenCalled();
    fireEvent.keyUp(window, { code: "Space", key: " " });
  });

  it("uses custom microphone options for manual and push-to-talk mode toggles", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Audio"), "custom");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Microphone bitrate (kb/s)" }), { target: { value: "80" } });
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Mute microphone" });
    setMicrophoneEnabled.mockClear();

    await user.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ channelCount: 1 }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 80_000 }) }),
    );
    await user.click(screen.getByRole("button", { name: "Unmute microphone" }));
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ channelCount: 1 }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 80_000 }) }),
    );

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ channelCount: 1 }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 80_000 }) }),
    );
    await user.click(screen.getByRole("radio", { name: /Voice detection/ }));
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ channelCount: 1 }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 80_000 }) }),
    );
  });

  it("persists push-to-talk before joining and starts the microphone muted", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));

    expect(screen.getByRole("radio", { name: /Push-to-talk/ })).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem("vocal.voice-settings.v1") ?? "{}").pushToTalk).toBe(true);
    expect(setMicrophoneEnabled).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Hold Space" });
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(false, expect.any(Object), expect.any(Object));
  });

  it("defers an active stream custom edit without republishing it", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Webcam"), "custom");
    setCameraEnabled.mockClear();
    const message = "The new webcam quality will apply the next time it's turned on.";
    const toastCount = screen.getAllByText(message).length;

    fireEvent.change(screen.getByRole("spinbutton", { name: "Webcam bitrate (kb/s)" }), { target: { value: "4200" } });

    expect(screen.getAllByText(message)).toHaveLength(toastCount + 1);
    expect(setCameraEnabled).not.toHaveBeenCalled();
  });

  it("recreates a stale camera publication once on its next enable", async () => {
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Webcam"), "custom");
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Mute microphone" });
    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    const firstPublication = localPublications.get("camera");
    const firstTrack = firstPublication?.track;
    expect(firstTrack?.publishOptions).toMatchObject({ videoEncoding: { maxBitrate: 1_700_000 } });

    await user.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Webcam bitrate (kb/s)" }), { target: { value: "4200" } });
    expect(localPublications.get("camera")?.track).toBe(firstTrack);
    expect(firstTrack?.stop).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(unpublishTrack).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    expect(localPublications.get("camera")?.track?.publishOptions).toMatchObject({
      videoEncoding: { maxBitrate: 4_200_000 },
    });
    const refreshedTrack = localPublications.get("camera")?.track;
    expect(refreshedTrack).not.toBe(firstTrack);
    expect(unpublishTrack).toHaveBeenCalledWith(firstTrack, true);
    expect(firstTrack?.stop).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Stop camera" }));
    await user.click(screen.getByRole("button", { name: "Turn on camera" }));
    expect(localPublications.get("camera")?.track).toBe(refreshedTrack);
    expect(unpublishTrack).toHaveBeenCalledTimes(1);
  });

  it("preserves custom screen capture settings when retrying without audio", async () => {
    const videoOnlyTrack = { kind: "video", attach: vi.fn(() => document.createElement("video")), detach: vi.fn(() => []), stop: vi.fn() };
    createScreenTracks
      .mockRejectedValueOnce(Object.assign(new Error("not supported"), { name: "NotSupportedError" }))
      .mockResolvedValueOnce([videoOnlyTrack]);
    await renderView({}, { join: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Screen share"), "custom");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Screen width (px)" }), { target: { value: "2560" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Screen height (px)" }), { target: { value: "1440" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Screen frame rate (fps)" }), { target: { value: "30" } });
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByRole("button", { name: "Mute microphone" });
    await user.click(screen.getByRole("button", { name: "Share screen" }));

    expect(createScreenTracks).toHaveBeenNthCalledWith(2, expect.objectContaining({
      audio: false,
      resolution: { width: 2560, height: 1440, frameRate: 30 },
      contentHint: "motion",
    }));
    expect(createScreenTracks.mock.calls[1][0]).not.toHaveProperty("systemAudio");
  });

  it("publishes screen share audio at the selected quality once advanced mode is on", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog", { name: "Voice & Video" });
    await user.click(screen.getByRole("switch", { name: "Advanced mode" }));
    await user.selectOptions(screen.getByLabelText("Screen share audio"), "low");
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    await user.click(screen.getByRole("button", { name: "Share screen" }));

    expect(publishTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "audio" }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 24_000 }) }),
    );
  });

  it("still publishes screen share audio at the default high quality when advanced mode is never touched", async () => {
    await renderView();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Share screen" }));

    expect(publishTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "audio" }),
      expect.objectContaining({ audioPreset: expect.objectContaining({ maxBitrate: 96_000 }) }),
    );
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

  it("plays remote screen-share audio and exposes a per-stream volume control", async () => {
    await renderView();
    const audio = document.createElement("audio");
    const remoteTrack = {
      kind: "audio",
      sid: "screen-audio-1",
      attach: vi.fn(() => audio),
      detach: vi.fn(() => [audio]),
    };
    const publication = { source: "screen_share_audio" };
    const participant = { identity: "u2", name: "alice" };

    act(() => roomHandlers.get("trackSubscribed")?.(remoteTrack, publication, participant));
    const slider = await screen.findByLabelText("alice screen share volume");
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(1);

    fireEvent.change(slider, { target: { value: "35" } });
    expect(audio.volume).toBe(0.35);
    expect(screen.getByText("35%")).toBeInTheDocument();

    act(() => roomHandlers.get("trackUnsubscribed")?.(remoteTrack, publication));
    expect(screen.queryByLabelText("alice screen share volume")).not.toBeInTheDocument();
  });

  it("publishes screen sharing in 1080p60 game mode", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog", { name: "Voice & Video" });
    await user.selectOptions(screen.getByLabelText("Screen share"), "game");
    await user.click(screen.getByRole("button", { name: "Share screen" }));

    expect(createScreenTracks).toHaveBeenLastCalledWith(
      expect.objectContaining({ resolution: expect.objectContaining({ width: 1920, height: 1080, frameRate: 60 }) }),
    );
    expect(publishTrack).toHaveBeenCalledWith(expect.objectContaining({ kind: "video" }), expect.objectContaining({ screenShareEncoding: expect.objectContaining({ maxFramerate: 60 }) }));
  });

  it("falls back to video-only screen sharing on Firefox", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Firefox/142.0");
    await renderView();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Share screen" }));
    expect(setScreenShareEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ audio: false }),
      expect.any(Object),
    );
    expect(await screen.findByText("Firefox does not support sharing tab or system audio. Sharing video only.")).toBeInTheDocument();
  });

  it("keeps the video share active when publishing its audio fails", async () => {
    publishTrack.mockResolvedValueOnce({ track: { kind: "video", attach: vi.fn(() => document.createElement("video")) } }).mockRejectedValueOnce(new Error("audio publish failed"));
    await renderView();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Share screen" }));
    expect(await screen.findByText("The screen is shared, but its audio could not be published.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
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
    createScreenTracks.mockRejectedValueOnce(Object.assign(new Error("cancel"), { name: "NotAllowedError" }));
    await user.click(screen.getByRole("button", { name: "Share screen" }));
    await screen.findByText("Screen share cancelled.");
    expect(playAppSound).not.toHaveBeenCalledWith("screenShare");
    // A dismissed/denied picker must not be retried -- retrying here would
    // silently reopen the OS picker right after the user closed it.
    expect(createScreenTracks).toHaveBeenCalledTimes(1);
  });

  it("retries without audio and shares video-only when the platform can't satisfy the audio request (NotSupportedError)", async () => {
    const videoOnlyTrack = { kind: "video", attach: vi.fn(() => document.createElement("video")), detach: vi.fn(() => []), stop: vi.fn() };
    createScreenTracks
      .mockRejectedValueOnce(Object.assign(new Error("not supported"), { name: "NotSupportedError" }))
      .mockResolvedValueOnce([videoOnlyTrack]);
    await renderView();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Share screen" }));

    expect(createScreenTracks).toHaveBeenCalledTimes(2);
    expect(createScreenTracks).toHaveBeenNthCalledWith(1, expect.objectContaining({ audio: true, systemAudio: "include" }));
    expect(createScreenTracks.mock.calls[1][0]).toMatchObject({ audio: false });
    expect(createScreenTracks.mock.calls[1][0]).not.toHaveProperty("systemAudio");
    expect(await screen.findByText("Could not share this screen's audio here. Sharing video only.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
    expect(playAppSound).toHaveBeenCalledWith("screenShare");
  });

  it("configures push-to-talk from voice settings", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("radio", { name: /Push-to-talk/ }));

    expect(screen.getByRole("radio", { name: /Push-to-talk/ })).toHaveAttribute("aria-checked", "true");
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false, expect.any(Object), expect.any(Object));
  });

  it("only persists the voice threshold to localStorage on release, not on every drag tick", async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const slider = await screen.findByLabelText("Voice threshold");

    fireEvent.change(slider, { target: { value: "0.3" } });
    let stored = JSON.parse(window.localStorage.getItem("vocal.voice-settings.v1") ?? "{}");
    expect(stored.vadThreshold).not.toBe(0.3);

    fireEvent.pointerUp(slider);
    stored = JSON.parse(window.localStorage.getItem("vocal.voice-settings.v1") ?? "{}");
    expect(stored.vadThreshold).toBe(0.3);
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
