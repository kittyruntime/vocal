import { useEffect, useRef, useState, type CSSProperties } from "react";
// Deliberately type-only: livekit-client is a large SDK (~500 kB), and
// VoiceView is already its own lazy-loaded chunk (see MainLayout.tsx) that
// loads as soon as a voice channel is *viewed*. Since joining is never
// automatic (see joinRoom below), there's no reason to pay for the SDK
// itself before the user actually clicks "Join" -- every runtime usage of
// these bindings goes through a dynamic `import("livekit-client")` instead
// (see loadLiveKit), scoped to the functions that only ever run once a room
// exists. Type-only imports are erased at compile time, so this costs
// nothing and doesn't conflict with the same names being used as local
// values (different namespaces) inside those functions.
import type {
  ConnectionError,
  ConnectionErrorReason,
  ConnectionQuality,
  LocalAudioTrack,
  LocalTrackPublication,
  MediaDeviceFailure,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
} from "livekit-client";
import type { Channel, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { playAppSound } from "../audio/sounds";
import { useToast } from "../toast/ToastContext";
import { Icon } from "../ui/Icon";
import { audioProfiles, cameraProfiles, screenProfiles, type MediaQuality, type QualityProfile, type ScreenQuality } from "./quality";
import { shouldOpenVoiceGate, VoiceGateProcessor } from "./VoiceGateProcessor";

type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting";
type NetworkQuality = "good" | "poor" | "lost";
type NetworkStats = { rttMs: number | null; packetLossPercent: number | null };
type ScreenAudioParticipant = { identity: string; name: string; trackSid: string };
type MediaKind = "microphone" | "camera" | "screen";
type DeviceSelections = Partial<Record<MediaDeviceKind, string>>;
type CallParticipant = {
  identity: string;
  name: string;
  avatarUrl: string | null;
  local: boolean;
  microphoneMuted: boolean;
  deafened: boolean;
};
type VoiceSettings = {
  devices: DeviceSelections;
  vadThreshold: number;
  pushToTalk: boolean;
  audioQuality: MediaQuality;
  cameraQuality: MediaQuality;
  screenQuality: ScreenQuality;
};

const SETTINGS_KEY = "vocal.voice-settings.v1";
const DEAFENED_ATTRIBUTE = "vocal.deafened";

function loadLiveKit() {
  return import("livekit-client");
}

function supportsScreenShareAudio(): boolean {
  // Firefox currently exposes getDisplayMedia but does not provide source/system
  // audio tracks. Asking LiveKit to publish audio can make the whole operation
  // fail instead of returning the usable video track.
  return !/Firefox\//i.test(navigator.userAgent);
}

function isQuality(value: unknown): value is MediaQuality {
  return value === "low" || value === "standard" || value === "high";
}

function isScreenQuality(value: unknown): value is ScreenQuality {
  return isQuality(value) || value === "game";
}

function loadSettings(): VoiceSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as {
      devices?: DeviceSelections; vadThreshold?: number; pushToTalk?: boolean;
      audioQuality?: unknown; cameraQuality?: unknown; screenQuality?: unknown;
    };
    return {
      devices: parsed.devices ?? {},
      vadThreshold: typeof parsed.vadThreshold === "number" ? parsed.vadThreshold : 0.15,
      pushToTalk: parsed.pushToTalk === true,
      audioQuality: isQuality(parsed.audioQuality) ? parsed.audioQuality : "standard",
      cameraQuality: isQuality(parsed.cameraQuality) ? parsed.cameraQuality : "standard",
      screenQuality: isScreenQuality(parsed.screenQuality) ? parsed.screenQuality : "standard",
    };
  } catch {
    return { devices: {}, vadThreshold: 0.15, pushToTalk: false, audioQuality: "standard", cameraQuality: "standard", screenQuality: "standard" };
  }
}

// Keyed by the string literal values of the real MediaDeviceFailure enum
// (verified against livekit-client's own type declarations: PermissionDenied
// / NotFound / DeviceInUse / Other are stable string enum members) rather
// than the enum import itself, so this table can be built at module load
// without pulling in livekit-client -- only `MediaDeviceFailure.getFailure`,
// the actual classification logic, needs the loaded SDK (see describeMediaError).
const MEDIA_ERROR_MESSAGES: Record<MediaKind, Partial<Record<"PermissionDenied" | "NotFound" | "DeviceInUse" | "Other", string>> & { default: string }> = {
  microphone: {
    PermissionDenied: "Microphone permission denied. Check your browser settings.",
    NotFound: "No microphone detected on this device.",
    DeviceInUse: "The microphone is already in use by another application.",
    default: "Could not enable the microphone.",
  },
  camera: {
    PermissionDenied: "Camera permission denied. Check your browser settings.",
    NotFound: "No camera detected on this device.",
    DeviceInUse: "The camera is already in use by another application.",
    default: "Could not enable the camera.",
  },
  screen: {
    // getDisplayMedia surfaces a cancelled picker as the same NotAllowedError
    // browsers use for an outright permission refusal — there is no reliable
    // way to tell the two apart, and "cancelled" is by far the more common
    // real-world case for screen sharing (there is no separate persistent OS
    // prompt to actively deny).
    PermissionDenied: "Screen share cancelled.",
    default: "Could not share the screen.",
  },
};

function describeMediaError(mediaDeviceFailure: typeof MediaDeviceFailure, error: unknown, kind: MediaKind): string {
  const failure = mediaDeviceFailure.getFailure(error);
  const messages = MEDIA_ERROR_MESSAGES[kind];
  return (failure && messages[failure]) || messages.default;
}

function describeJoinError(
  connectionError: typeof ConnectionError,
  connectionErrorReason: typeof ConnectionErrorReason,
  mediaDeviceFailure: typeof MediaDeviceFailure,
  error: unknown,
): string {
  if (error instanceof api.ApiError) {
    return error.message === "not a voice channel"
      ? "This channel is not a voice channel"
      : `Voice connection refused: ${error.message}`;
  }
  if (error instanceof connectionError) {
    const unreachableReasons: ConnectionErrorReason[] = [
      connectionErrorReason.ServerUnreachable,
      connectionErrorReason.WebSocket,
      connectionErrorReason.Timeout,
    ];
    return unreachableReasons.includes(error.reason)
      ? "Network connection failed. Check your connection and try again."
      : "Could not join the voice channel";
  }
  return describeMediaError(mediaDeviceFailure, error, "microphone");
}

// How often to sample WebRTC stats for the RTT/packet-loss readout while
// connected -- frequent enough to feel live, cheap enough not to matter.
const STATS_SAMPLE_INTERVAL_MS = 2500;
// Consecutive "good" ConnectionQuality updates required before restoring
// downgraded remote video back to HIGH, so a connection that's merely
// flapping between poor/good doesn't thrash video quality back and forth.
const GOOD_STREAK_TO_RESTORE_QUALITY = 3;

function mapConnectionQuality(connectionQuality: typeof ConnectionQuality, quality: ConnectionQuality): NetworkQuality | null {
  switch (quality) {
    case connectionQuality.Excellent:
    case connectionQuality.Good:
      return "good";
    case connectionQuality.Poor:
      return "poor";
    case connectionQuality.Lost:
      return "lost";
    default:
      return null;
  }
}

// Built via DOM APIs rather than rendered through the <Icon> React component: these
// buttons are appended to video tiles built with plain DOM calls (see TrackSubscribed
// and the camera/screen-share toggles below), matching that imperative style instead
// of mounting a nested React root just for one small icon. No innerHTML: every node is
// created explicitly, so there's no HTML-string path to accidentally feed untrusted
// data into later. Paths match lucide-react's maximize-2 / minimize-2 icons for visual
// consistency with the rest of the UI.
const SVG_NS = "http://www.w3.org/2000/svg";
const FULLSCREEN_ENTER_PATHS = ["M15 3h6v6", "m21 3-7 7", "m3 21 7-7", "M9 21H3v-6"];
const FULLSCREEN_EXIT_PATHS = ["m14 10 7-7", "M20 10h-6V4", "m3 21 7-7", "M4 14h6v6"];

function buildFullscreenIcon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.1");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// Appends a fullscreen toggle button to `tile` (a positioned video-tile/local-video
// container). The button's fullscreen target is always its own parent element, so a
// single delegated "fullscreenchange" listener (registered once by the component, see
// the effect below) can keep every tile's icon in sync without per-tile listeners to
// track and clean up as tiles are created/destroyed.
function addFullscreenButton(tile: HTMLElement): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tile-fullscreen-button";
  button.setAttribute("aria-label", "Enter fullscreen");
  button.title = "Enter fullscreen";
  button.append(buildFullscreenIcon(FULLSCREEN_ENTER_PATHS));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const target = (event.currentTarget as HTMLButtonElement).parentElement;
    if (!target) return;
    if (document.fullscreenElement === target) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen?.().catch(() => {});
    }
  });
  tile.append(button);
}

function applyRemoteVideoQuality(room: Room, quality: VideoQuality): void {
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.videoTrackPublications.values()) {
      publication.setVideoQuality(quality);
    }
  }
}

export function VoiceView({
  channel,
  currentUser,
  visible = true,
  onOpenSidebar,
  onViewProfile,
  onSpeakingChange,
  onParticipantsChange,
  onSelfMediaStatusChange,
  onSelfPresenceChange,
}: {
  channel: Channel;
  currentUser: CurrentUser;
  visible?: boolean;
  onOpenSidebar?(): void;
  onViewProfile?(userId: string): void;
  onSpeakingChange?(userIds: string[]): void;
  onParticipantsChange?(participants: { userId: string; username: string; avatarUrl?: string | null }[]): void;
  onSelfMediaStatusChange?(channelId: string, status: { microphoneMuted: boolean; deafened: boolean }): void;
  onSelfPresenceChange?(present: boolean): void;
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [settings, setSettings] = useState(() => ({
    ...loadSettings(),
    audioQuality: channel.defaultAudioQuality ?? "standard",
    cameraQuality: channel.defaultCameraQuality ?? "standard",
    screenQuality: channel.defaultScreenQuality ?? "standard",
  }));
  const [audioLevel, setAudioLevel] = useState(0);
  const [remoteVideoCount, setRemoteVideoCount] = useState(0);
  const [remoteScreenCount, setRemoteScreenCount] = useState(0);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<Set<string>>(() => new Set());
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"grid" | "focus">("grid");
  const [pinnedTileId, setPinnedTileId] = useState<string | null>(null);
  const [hideAudioOnly, setHideAudioOnly] = useState(true);
  const [videoParticipantIds, setVideoParticipantIds] = useState<Set<string>>(() => new Set());
  const [screenAudioParticipants, setScreenAudioParticipants] = useState<ScreenAudioParticipant[]>([]);
  const [screenAudioVolumes, setScreenAudioVolumes] = useState<Record<string, number>>({});
  const [connectionQuality, setConnectionQuality] = useState<NetworkQuality | null>(null);
  const [networkStats, setNetworkStats] = useState<NetworkStats>({ rttMs: null, packetLossPercent: null });
  const roomRef = useRef<Room | null>(null);
  const voiceViewRef = useRef<HTMLElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const screenAudioVolumesRef = useRef<Record<string, number>>({});
  const refreshParticipantsRef = useRef<((localState?: { microphoneMuted?: boolean; deafened?: boolean }) => void) | null>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const localCameraRef = useRef<HTMLDivElement>(null);
  const localScreenRef = useRef<HTMLDivElement>(null);
  const deafenedRef = useRef(false);
  const activeSpeakersRef = useRef(new Set<string>());
  const meterCleanupRef = useRef<(() => Promise<void>) | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const pttPressedRef = useRef(false);
  const voiceGateRef = useRef<VoiceGateProcessor | null>(null);
  const settingsRef = useRef(settings);
  const lastVoiceActivityRef = useRef(0);
  const reconnectingRef = useRef(false);
  const videoDowngradedRef = useRef(false);
  const goodQualityStreakRef = useRef(0);

  function saveSettings(next: typeof settings) {
    settingsRef.current = next;
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  function stopMeter() {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    const cleanup = meterCleanupRef.current;
    meterCleanupRef.current = null;
    if (cleanup) void cleanup();
    const gate = voiceGateRef.current;
    voiceGateRef.current = null;
    if (gate) void gate.destroy();
    setAudioLevel(0);
  }

  function startMeter(createAudioAnalyser: typeof import("livekit-client").createAudioAnalyser, track: LocalAudioTrack) {
    stopMeter();
    try {
      const analyser = createAudioAnalyser(track, { cloneTrack: true, smoothingTimeConstant: 0.7 });
      meterCleanupRef.current = analyser.cleanup;
      const update = () => {
        const level = analyser.calculateVolume();
        setAudioLevel(level);
        const gate = voiceGateRef.current;
        if (gate && !settingsRef.current.pushToTalk) {
          const now = performance.now();
          if (level >= settingsRef.current.vadThreshold) lastVoiceActivityRef.current = now;
          gate.setOpen(shouldOpenVoiceGate(level, settingsRef.current.vadThreshold, now, lastVoiceActivityRef.current));
        }
        meterFrameRef.current = requestAnimationFrame(update);
      };
      update();
    } catch {
      // The audio call remains usable on browsers without Web Audio support.
    }
  }

  async function installVoiceGate(track: LocalAudioTrack) {
    const gate = new VoiceGateProcessor();
    try {
      await track.setProcessor(gate);
      voiceGateRef.current = gate;
      lastVoiceActivityRef.current = 0;
    } catch {
      await gate.destroy();
      showToast("Voice detection is not supported by this browser");
    }
  }

  function updateSpeakingTiles(activeIds: Set<string>) {
    activeSpeakersRef.current = activeIds;
    const containers = [remoteVideoRef.current, localCameraRef.current, localScreenRef.current];
    for (const container of containers) {
      if (!container) continue;
      const candidates = container.dataset.participantId ? [container] : [...container.children];
      for (const candidate of candidates) {
        const element = candidate as HTMLElement;
        element.classList.toggle("is-speaking", activeIds.has(element.dataset.participantId ?? ""));
        element.style.order = activeIds.has(element.dataset.participantId ?? "") ? "-1" : element.classList.contains("screen-share") || element.classList.contains("local-screen") ? "-2" : "0";
      }
    }
  }

  function clearMedia() {
    audioRef.current?.replaceChildren();
    remoteVideoRef.current?.replaceChildren();
    localCameraRef.current?.replaceChildren();
    localScreenRef.current?.replaceChildren();
    setScreenAudioParticipants([]);
  }

  function setScreenAudioVolume(participantId: string, volume: number) {
    const next = { ...screenAudioVolumesRef.current, [participantId]: volume };
    screenAudioVolumesRef.current = next;
    setScreenAudioVolumes(next);
    for (const element of audioRef.current?.querySelectorAll<HTMLMediaElement>('audio[data-source="screen-share-audio"]') ?? []) {
      if (element.dataset.participantId === participantId) element.volume = volume / 100;
    }
  }

  // Shared by every path that ends a room connection (voluntary leave,
  // involuntary disconnect, and switching to a different voice channel while
  // still connected) so none of them can drift out of sync with each other
  // and leave stale "connected" UI state behind.
  function resetCallState() {
    setStatus("idle");
    setMicrophoneEnabled(false);
    setDeafened(false);
    deafenedRef.current = false;
    setCameraEnabled(false);
    setScreenShareEnabled(false);
    setRemoteVideoCount(0);
    setRemoteScreenCount(0);
    setActiveSpeakerIds(new Set());
    setCallParticipants([]);
    setPinnedTileId(null);
    setVideoParticipantIds(new Set());
    setConnectionQuality(null);
    setNetworkStats({ rttMs: null, packetLossPercent: null });
    activeSpeakersRef.current.clear();
    videoDowngradedRef.current = false;
    goodQualityStreakRef.current = 0;
    stopMeter();
    onSpeakingChange?.([]);
    onSelfPresenceChange?.(false);
  }

  async function leaveRoom() {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    clearMedia();
    resetCallState();
  }

  // Runs whenever `channel.id` changes, including switching directly from one
  // voice channel to another while still connected -- VoiceView isn't
  // remounted in that case (same component, new prop), so without this the
  // old room would stay connected in the background. Joining is always a
  // deliberate user action (the "Join" button) -- switching channels never
  // auto-connects to the new one, it only leaves the old one cleanly.
  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.disconnect();
      clearMedia();
      resetCallState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  // Keeps every tile's fullscreen button icon (enter/exit) in sync with the browser's
  // actual fullscreen state, including when the user exits via Escape or the browser's
  // own UI rather than clicking the button again. One delegated listener for the whole
  // view instead of one per tile — see addFullscreenButton's comment for why.
  useEffect(() => {
    const syncFullscreenButtons = () => {
      const buttons = voiceViewRef.current?.querySelectorAll<HTMLButtonElement>(".tile-fullscreen-button") ?? [];
      for (const button of buttons) {
        const active = document.fullscreenElement === button.parentElement;
        button.replaceChildren(buildFullscreenIcon(active ? FULLSCREEN_EXIT_PATHS : FULLSCREEN_ENTER_PATHS));
        const label = active ? "Exit fullscreen" : "Enter fullscreen";
        button.setAttribute("aria-label", label);
        button.title = label;
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreenButtons);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenButtons);
  }, []);

  useEffect(() => {
    setSettings((value) => {
      const next = {
        ...value,
        audioQuality: channel.defaultAudioQuality ?? "standard",
        cameraQuality: channel.defaultCameraQuality ?? "standard",
        screenQuality: channel.defaultScreenQuality ?? "standard",
      };
      settingsRef.current = next;
      return next;
    });
  }, [channel.id]);

  async function joinRoom() {
    if (status !== "idle") return;
    setStatus("connecting");
    reconnectingRef.current = false;
    let liveKit: Awaited<ReturnType<typeof loadLiveKit>>;
    try {
      liveKit = await loadLiveKit();
    } catch {
      setStatus("idle");
      showToast("Could not load voice chat. Check your connection and try again.");
      return;
    }
    const {
      Room, RoomEvent, Track, VideoQuality, ConnectionQuality,
      ConnectionError, ConnectionErrorReason, MediaDeviceFailure, createAudioAnalyser,
    } = liveKit;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const syncRemoteVideoCounts = () => {
      const tiles = [...(remoteVideoRef.current?.querySelectorAll<HTMLElement>(".video-tile") ?? [])];
      setRemoteVideoCount(tiles.length);
      setRemoteScreenCount(tiles.filter((tile) => tile.classList.contains("screen-share")).length);
      setVideoParticipantIds(new Set(tiles.map((tile) => tile.dataset.participantId).filter((value): value is string => Boolean(value))));
    };

    const attachRemoteTrack = (
      track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant,
    ) => {
      if (track.kind === Track.Kind.Audio) {
        if (audioRef.current?.querySelector(`[data-track-sid="${track.sid}"]`)) return;
        const trackSid = track.sid ?? publication.trackSid ?? `${participant.identity}:screen-audio`;
        const element = track.attach();
        element.dataset.trackSid = trackSid;
        element.dataset.participantId = participant.identity;
        element.muted = deafenedRef.current;
        if (publication.source === Track.Source.ScreenShareAudio) {
          element.dataset.source = "screen-share-audio";
          element.volume = (screenAudioVolumesRef.current[participant.identity] ?? 100) / 100;
          setScreenAudioParticipants((participants) => participants.some((entry) => entry.trackSid === trackSid)
            ? participants
            : [...participants, { identity: participant.identity, name: participant.name || participant.identity, trackSid }]);
        }
        audioRef.current?.append(element);
        return;
      }
      if (track.kind !== Track.Kind.Video) return;
      if (remoteVideoRef.current?.querySelector(`[data-track-sid="${track.sid}"]`)) return;
      // A newly subscribed video track should start out at the same quality
      // the rest of the call is currently downgraded to, not default HIGH.
      if (videoDowngradedRef.current) publication.setVideoQuality(VideoQuality.LOW);
      const tile = document.createElement("figure");
      const tileId = track.sid ?? publication.trackSid;
      tile.className = publication.source === Track.Source.ScreenShare ? "video-tile screen-share" : "video-tile";
      tile.dataset.trackSid = track.sid;
      tile.dataset.participantId = participant.identity;
      tile.dataset.tileId = tileId;
      tile.title = "Click to pin this tile";
      tile.classList.toggle("is-speaking", activeSpeakersRef.current.has(participant.identity));
      const element = track.attach();
      element.setAttribute("playsinline", "");
      const label = document.createElement("figcaption");
      label.textContent = participant.name || participant.identity;
      tile.append(element, label);
      addFullscreenButton(tile);
      tile.addEventListener("click", () => setPinnedTileId((value) => value === tileId ? null : tileId));
      remoteVideoRef.current?.append(tile);
      syncRemoteVideoCounts();
    };

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        attachRemoteTrack(track, publication, participant);
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
      for (const element of track.detach()) element.remove();
      for (const child of remoteVideoRef.current?.children ?? []) {
        if ((child as HTMLElement).dataset.trackSid === track.sid) child.remove();
      }
      setPinnedTileId((value) => value === track.sid ? null : value);
      if (publication.source === Track.Source.ScreenShareAudio) {
        const trackSid = track.sid ?? publication.trackSid;
        setScreenAudioParticipants((participants) => participants.filter((entry) => entry.trackSid !== trackSid));
      }
      if (track.kind === Track.Kind.Video) syncRemoteVideoCounts();
    });
    room.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.Camera) {
        localCameraRef.current?.replaceChildren();
        setCameraEnabled(false);
      } else if (publication.source === Track.Source.ScreenShare) {
        localScreenRef.current?.replaceChildren();
        setScreenShareEnabled(false);
      }
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const activeIds = new Set(speakers.map((participant) => participant.identity));
      updateSpeakingTiles(activeIds);
      setActiveSpeakerIds(activeIds);
      onSpeakingChange?.([...activeIds]);
    });
    room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
      if (!participant.isLocal) return;
      const mapped = mapConnectionQuality(ConnectionQuality, quality);
      setConnectionQuality(mapped);
      if (mapped === "poor" || mapped === "lost") {
        goodQualityStreakRef.current = 0;
        if (!videoDowngradedRef.current) {
          videoDowngradedRef.current = true;
          applyRemoteVideoQuality(room, VideoQuality.LOW);
        }
      } else if (mapped === "good" && videoDowngradedRef.current) {
        goodQualityStreakRef.current += 1;
        if (goodQualityStreakRef.current >= GOOD_STREAK_TO_RESTORE_QUALITY) {
          videoDowngradedRef.current = false;
          goodQualityStreakRef.current = 0;
          applyRemoteVideoQuality(room, VideoQuality.HIGH);
        }
      }
    });
    const refreshParticipants = (localState: { microphoneMuted?: boolean; deafened?: boolean } = {}) => {
      const localIdentity = room.localParticipant.identity || currentUser.id;
      const localMicrophone = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const participants: CallParticipant[] = [
        {
          identity: localIdentity,
          name: room.localParticipant.name || currentUser.username,
          avatarUrl: currentUser.avatarUrl ?? null,
          local: true,
          microphoneMuted: localState.microphoneMuted ?? localMicrophone?.isMuted ?? true,
          deafened: localState.deafened ?? room.localParticipant.attributes?.[DEAFENED_ATTRIBUTE] === "true",
        },
        ...[...room.remoteParticipants.values()].map((participant) => {
          let avatarUrl: string | null = null;
          try {
            const metadata = JSON.parse(participant.metadata || "{}");
            if (typeof metadata.avatarUrl === "string") avatarUrl = metadata.avatarUrl;
          } catch { /* Participant metadata is optional. */ }
          const microphone = participant.getTrackPublication?.(Track.Source.Microphone)
            ?? [...(participant.audioTrackPublications?.values?.() ?? [])].find((publication) => publication.source === Track.Source.Microphone);
          return {
            identity: participant.identity,
            name: participant.name || participant.identity,
            avatarUrl,
            local: false,
            microphoneMuted: microphone?.isMuted ?? true,
            deafened: participant.attributes?.[DEAFENED_ATTRIBUTE] === "true",
          };
        }),
      ];
      setCallParticipants(participants);
      for (const container of [remoteVideoRef.current, localCameraRef.current, localScreenRef.current]) {
        if (!container) continue;
        const tiles = container.dataset.participantId ? [container] : [...container.querySelectorAll<HTMLElement>("[data-participant-id]")];
        for (const tile of tiles) {
          const participant = participants.find((entry) => entry.identity === tile.dataset.participantId);
          tile.querySelector(".tile-media-status")?.remove();
          if (!participant || (!participant.microphoneMuted && !participant.deafened)) continue;
          const status = document.createElement("span");
          status.className = "tile-media-status";
          status.textContent = [participant.microphoneMuted ? "Mic muted" : null, participant.deafened ? "Deafened" : null].filter(Boolean).join(" · ");
          tile.append(status);
        }
      }
      onParticipantsChange?.(participants.map((participant) => ({
        userId: participant.identity,
        username: participant.name,
        avatarUrl: participant.avatarUrl,
        microphoneMuted: participant.microphoneMuted,
        deafened: participant.deafened,
      })));
    };
    refreshParticipantsRef.current = refreshParticipants;
    room.on(RoomEvent.ParticipantConnected, () => refreshParticipants());
    room.on(RoomEvent.ParticipantDisconnected, () => refreshParticipants());
    room.on(RoomEvent.TrackMuted, () => refreshParticipants());
    room.on(RoomEvent.TrackUnmuted, () => refreshParticipants());
    room.on(RoomEvent.ParticipantAttributesChanged, () => refreshParticipants());
    room.on(RoomEvent.ParticipantPermissionsChanged, (prevPermissions, participant) => {
      if (!participant.isLocal) return;
      if (prevPermissions?.canPublish && participant.permissions?.canPublish === false) {
        playAppSound("forceMuted");
      }
    });
    room.on(RoomEvent.Reconnecting, () => {
      reconnectingRef.current = true;
      if (roomRef.current === room) setStatus("reconnecting");
    });
    room.on(RoomEvent.Reconnected, () => {
      reconnectingRef.current = false;
      if (roomRef.current === room) setStatus("connected");
    });
    room.on(RoomEvent.Disconnected, () => {
      if (roomRef.current === room) {
        const lostAfterReconnecting = reconnectingRef.current;
        reconnectingRef.current = false;
        roomRef.current = null;
        clearMedia();
        resetCallState();
        if (lostAfterReconnecting) {
          showToast("Voice connection lost after several reconnection attempts.");
        }
      }
    });

    try {
      const { token, url } = await api.getVoiceToken(channel.id);
      await room.connect(url, token);
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.track) attachRemoteTrack(publication.track, publication, participant);
        }
      }
      for (const [kind, deviceId] of Object.entries(settings.devices)) {
        if (deviceId) await room.switchActiveDevice(kind as MediaDeviceKind, deviceId, false);
      }
      const audioProfile = audioProfiles[settings.audioQuality];
      const microphone = await room.localParticipant.setMicrophoneEnabled(!settings.pushToTalk, audioProfile.capture, audioProfile.publish);
      setMicrophoneEnabled(!settings.pushToTalk);
      void room.localParticipant.setAttributes({ [DEAFENED_ATTRIBUTE]: "false" }).catch(() => {
        showToast("Could not share your sound status");
      });
      if (microphone?.audioTrack) {
        startMeter(createAudioAnalyser, microphone.audioTrack);
        if (!settings.pushToTalk) await installVoiceGate(microphone.audioTrack);
      }
      setDevices(await Room.getLocalDevices(undefined, false));
      refreshParticipants({ microphoneMuted: settings.pushToTalk, deafened: false });
      onSelfMediaStatusChange?.(channel.id, { microphoneMuted: settings.pushToTalk, deafened: false });
      setStatus("connected");
      onSelfPresenceChange?.(true);
    } catch (error) {
      await room.disconnect();
      if (roomRef.current === room) roomRef.current = null;
      setStatus("idle");
      setMicrophoneEnabled(false);
      stopMeter();
      showToast(describeJoinError(ConnectionError, ConnectionErrorReason, MediaDeviceFailure, error));
    }
  }

  async function selectDevice(kind: MediaDeviceKind, deviceId: string) {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.switchActiveDevice(kind, deviceId);
      saveSettings({ ...settings, devices: { ...settings.devices, [kind]: deviceId } });
    } catch {
      showToast("Could not change device");
    }
  }

  async function togglePushToTalk() {
    const room = roomRef.current;
    if (!room) return;
    const enabled = !settings.pushToTalk;
    saveSettings({ ...settings, pushToTalk: enabled });
    pttPressedRef.current = false;
    try {
      const profile = audioProfiles[settings.audioQuality];
      const publication = await room.localParticipant.setMicrophoneEnabled(!enabled, profile.capture, profile.publish);
      if (enabled) {
        voiceGateRef.current = null;
        if (publication?.audioTrack?.getProcessor()) await publication.audioTrack.stopProcessor();
      } else if (publication?.audioTrack) {
        await installVoiceGate(publication.audioTrack);
      }
      setMicrophoneEnabled(!enabled);
      refreshParticipantsRef.current?.({ microphoneMuted: enabled, deafened });
      onSelfMediaStatusChange?.(channel.id, { microphoneMuted: enabled, deafened });
    } catch {
      showToast("Could not enable push-to-talk");
    }
  }

  useEffect(() => {
    if ((status !== "connected" && status !== "reconnecting") || !settings.pushToTalk) return;
    const setPressed = (pressed: boolean) => {
      if (pttPressedRef.current === pressed) return;
      pttPressedRef.current = pressed;
      const room = roomRef.current;
      if (!room) return;
      const profile = audioProfiles[settings.audioQuality];
      void room.localParticipant.setMicrophoneEnabled(pressed, profile.capture, profile.publish).then(() => {
        setMicrophoneEnabled(pressed);
        refreshParticipantsRef.current?.({ microphoneMuted: !pressed, deafened });
        onSelfMediaStatusChange?.(channel.id, { microphoneMuted: !pressed, deafened });
      }).catch(async (error) => {
        const { MediaDeviceFailure } = await loadLiveKit();
        showToast(describeMediaError(MediaDeviceFailure, error, "microphone"));
      });
    };
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return element?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName ?? "");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isTyping(event.target)) return;
      event.preventDefault();
      setPressed(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event.target)) return;
      event.preventDefault();
      setPressed(false);
    };
    const onBlur = () => setPressed(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      setPressed(false);
    };
  }, [deafened, onSelfMediaStatusChange, settings.audioQuality, settings.pushToTalk, showToast, status]);

  async function toggleMicrophone() {
    const room = roomRef.current;
    if (!room || (status !== "connected" && status !== "reconnecting")) return;
    const enabled = !microphoneEnabled;
    try {
      const profile = audioProfiles[settings.audioQuality];
      await room.localParticipant.setMicrophoneEnabled(enabled, profile.capture, profile.publish);
      setMicrophoneEnabled(enabled);
      refreshParticipantsRef.current?.({ microphoneMuted: !enabled, deafened });
      onSelfMediaStatusChange?.(channel.id, { microphoneMuted: !enabled, deafened });
      playAppSound("muteToggle");
    } catch (error) {
      const { MediaDeviceFailure } = await loadLiveKit();
      showToast(describeMediaError(MediaDeviceFailure, error, "microphone"));
    }
  }

  async function toggleDeafen() {
    const room = roomRef.current;
    if (!room) return;
    const next = !deafened;
    deafenedRef.current = next;
    setDeafened(next);
    for (const element of audioRef.current?.querySelectorAll("audio") ?? []) {
      element.muted = next;
    }
    refreshParticipantsRef.current?.({ microphoneMuted: !microphoneEnabled, deafened: next });
    onSelfMediaStatusChange?.(channel.id, { microphoneMuted: !microphoneEnabled, deafened: next });
    try {
      await room.localParticipant.setAttributes({ [DEAFENED_ATTRIBUTE]: String(next) });
    } catch {
      showToast("Could not share your sound status");
    }
  }

  async function toggleCamera() {
    const room = roomRef.current;
    if (!room || (status !== "connected" && status !== "reconnecting")) return;
    const { Track, MediaDeviceFailure } = await loadLiveKit();
    const enabled = !cameraEnabled;
    const previousTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    try {
      const profile = cameraProfiles[settings.cameraQuality];
      const publication = await room.localParticipant.setCameraEnabled(enabled, profile.capture, profile.publish);
      localCameraRef.current?.replaceChildren();
      if (enabled && publication?.track) {
        const element = publication.track.attach();
        element.muted = true;
        element.setAttribute("playsinline", "");
        const label = document.createElement("span");
        label.className = "local-video-label";
        label.textContent = `${currentUser.username} (you)`;
        localCameraRef.current?.append(element, label);
        localCameraRef.current!.dataset.tileId = "local-camera";
        if (localCameraRef.current) addFullscreenButton(localCameraRef.current);
      } else if (!enabled && previousTrack) {
        for (const element of previousTrack.detach()) element.remove();
      }
      setCameraEnabled(enabled);
      if (!enabled) setPinnedTileId((value) => value === "local-camera" ? null : value);
    } catch (error) {
      showToast(describeMediaError(MediaDeviceFailure, error, "camera"));
    }
  }

  async function toggleScreenShare() {
    const room = roomRef.current;
    if (!room || (status !== "connected" && status !== "reconnecting")) return;
    const { Track, MediaDeviceFailure } = await loadLiveKit();
    const enabled = !screenShareEnabled;
    const previousTrack = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    try {
      const profile = screenProfiles[settings.screenQuality];
      const audioSupported = supportsScreenShareAudio();
      const captureOptions = enabled
        ? { ...profile.capture, audio: audioSupported, ...(audioSupported ? { systemAudio: "include" as const } : {}) }
        : profile.capture;
      let publication;
      if (enabled && audioSupported) {
        const tracks = await room.localParticipant.createScreenTracks(captureOptions);
        const videoTrack = tracks.find((track) => track.kind === Track.Kind.Video);
        const audioTrack = tracks.find((track) => track.kind === Track.Kind.Audio);
        if (!videoTrack) throw new Error("Screen capture did not provide a video track");
        try {
          publication = await room.localParticipant.publishTrack(videoTrack, profile.publish);
        } catch (error) {
          for (const track of tracks) track.stop();
          throw error;
        }
        if (audioTrack) {
          try {
            await room.localParticipant.publishTrack(audioTrack, audioProfiles.high.publish);
          } catch {
            audioTrack.stop();
            showToast("The screen is shared, but its audio could not be published.");
          }
        }
      } else {
        publication = await room.localParticipant.setScreenShareEnabled(enabled, captureOptions, profile.publish);
      }
      localScreenRef.current?.replaceChildren();
      if (enabled && publication?.track) {
        const element = publication.track.attach();
        element.muted = true;
        element.setAttribute("playsinline", "");
        const label = document.createElement("span");
        label.className = "local-video-label";
        label.textContent = `${currentUser.username} · Screen`;
        localScreenRef.current?.append(element, label);
        localScreenRef.current!.dataset.tileId = "local-screen";
        if (localScreenRef.current) addFullscreenButton(localScreenRef.current);
      } else if (!enabled && previousTrack) {
        for (const element of previousTrack.detach()) element.remove();
      }
      setScreenShareEnabled(enabled);
      playAppSound("screenShare");
      if (enabled && !audioSupported) showToast("Firefox does not support sharing tab or system audio. Sharing video only.");
      if (!enabled) setPinnedTileId((value) => value === "local-screen" ? null : value);
    } catch (error) {
      showToast(describeMediaError(MediaDeviceFailure, error, "screen"));
    }
  }

  function selectQuality(kind: "audio" | "camera", quality: MediaQuality): void;
  function selectQuality(kind: "screen", quality: ScreenQuality): void;
  function selectQuality(kind: "audio" | "camera" | "screen", quality: ScreenQuality) {
    const key = `${kind}Quality` as const;
    saveSettings({ ...settings, [key]: quality });
    const active = kind === "audio" ? microphoneEnabled : kind === "camera" ? cameraEnabled : screenShareEnabled;
    if (active) showToast(`The new ${kind === "audio" ? "audio" : kind === "camera" ? "webcam" : "screen share"} quality will apply the next time it's turned on.`);
  }

  const hasVideo = cameraEnabled || screenShareEnabled || remoteVideoCount > 0;
  const hasScreenShare = screenShareEnabled || remoteScreenCount > 0;
  const videoTileCount = remoteVideoCount + Number(cameraEnabled) + Number(screenShareEnabled);
  const videoColumns = videoTileCount <= 1 ? 1 : videoTileCount <= 4 ? 2 : videoTileCount <= 9 ? 3 : 4;
  const videoRows = Math.max(1, Math.ceil(videoTileCount / videoColumns));
  const videoGridStyle = {
    "--video-columns": videoColumns,
    "--video-rows": videoRows,
  } as CSSProperties;
  const localSpeaking = microphoneEnabled && audioLevel >= settings.vadThreshold;
  const audioOnlyParticipants = callParticipants.filter((participant) => !(participant.local ? cameraEnabled || screenShareEnabled : videoParticipantIds.has(participant.identity)));

  useEffect(() => {
    for (const tile of voiceViewRef.current?.querySelectorAll<HTMLElement>("[data-tile-id]") ?? []) tile.classList.toggle("is-pinned", tile.dataset.tileId === pinnedTileId);
  }, [pinnedTileId, remoteVideoCount, cameraEnabled, screenShareEnabled]);

  useEffect(() => {
    if (layoutMode !== "focus" || pinnedTileId || !hasVideo) return;
    const preferred = voiceViewRef.current?.querySelector<HTMLElement>(".screen-share[data-tile-id], .local-screen[data-tile-id]:not(:empty), .video-tile[data-tile-id], .local-video[data-tile-id]:not(:empty)");
    if (preferred?.dataset.tileId) setPinnedTileId(preferred.dataset.tileId);
  }, [layoutMode, pinnedTileId, hasVideo, remoteVideoCount, cameraEnabled, screenShareEnabled]);

  // Samples RTT and packet loss from whichever local track is currently
  // active every couple of seconds while connected. Both figures are
  // best-effort: not every browser exposes `remote-inbound-rtp` stats, so a
  // missing value just stays null instead of showing a misleading number.
  useEffect(() => {
    if (status !== "connected") {
      setNetworkStats({ rttMs: null, packetLossPercent: null });
      return;
    }
    let cancelled = false;
    async function sample() {
      const room = roomRef.current;
      if (!room) return;
      const { Track } = await loadLiveKit();
      const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
        ?? room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
        ?? room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
      if (!track || cancelled) return;
      let report: RTCStatsReport | undefined;
      try {
        report = await track.getRTCStatsReport();
      } catch {
        return;
      }
      if (!report || cancelled) return;
      let rttMs: number | null = null;
      let packetLossPercent: number | null = null;
      report.forEach((stat: RTCStats) => {
        const candidatePair = stat as RTCIceCandidatePairStats;
        if (stat.type === "candidate-pair" && (candidatePair.nominated || candidatePair.state === "succeeded")
          && typeof candidatePair.currentRoundTripTime === "number") {
          rttMs = Math.round(candidatePair.currentRoundTripTime * 1000);
        }
        const remoteInbound = stat as RTCStats & { fractionLost?: number };
        if (stat.type === "remote-inbound-rtp" && typeof remoteInbound.fractionLost === "number") {
          packetLossPercent = Math.round(remoteInbound.fractionLost * 1000) / 10;
        }
      });
      if (!cancelled) setNetworkStats({ rttMs, packetLossPercent });
    }
    void sample();
    const interval = window.setInterval(() => void sample(), STATS_SAMPLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [status]);

  return (
    <section className="voice-view" aria-label={`Voice channel ${channel.name}`} hidden={!visible} ref={voiceViewRef}>
      <header className="chat-header">
        <button type="button" className="mobile-menu-button" aria-label="Open channel list" onClick={() => onOpenSidebar?.()}>
          <Icon name="menu" size={20} />
        </button>
        <span className="header-channel-icon"><Icon name="volume" size={21} /></span> {channel.name}
        {(status === "connected" || status === "reconnecting") && connectionQuality ? (
          <span
            className={`connection-quality-badge quality-${connectionQuality}`}
            title={networkStats.rttMs !== null
              ? `${networkStats.rttMs} ms${networkStats.packetLossPercent !== null ? ` · ${networkStats.packetLossPercent}% loss` : ""}`
              : undefined}
          >
            {connectionQuality === "good" ? "Good" : connectionQuality === "poor" ? "Poor" : "Lost"}
          </span>
        ) : null}
        {(status === "connected" || status === "reconnecting") ? <div className="voice-layout-actions"><button type="button" className={layoutMode === "grid" ? "active" : ""} onClick={() => { setLayoutMode("grid"); setPinnedTileId(null); }}>Grid</button><button type="button" className={layoutMode === "focus" ? "active" : ""} onClick={() => setLayoutMode("focus")}>Focus</button>{hasVideo ? <button type="button" className={!hideAudioOnly ? "active" : ""} onClick={() => setHideAudioOnly((value) => !value)}>{hideAudioOnly ? "Show audio" : "Hide audio"}</button> : null}</div> : null}
      </header>
      <div className="voice-stage">
        {status === "idle" || status === "connecting" ? <div className="voice-hero">
          <div className="voice-hero-icon"><Icon name="volume" size={28} /></div>
          <h1>{channel.name}</h1>
          <p>Join the channel to talk, share your camera, or share your screen.</p>
        </div> : null}
        {status === "reconnecting" ? (
          <div className="voice-reconnect-banner" role="status">
            <span className="connecting-dots" aria-hidden="true"><i /><i /><i /></span> Reconnecting…
          </div>
        ) : null}
        {(status === "connected" || status === "reconnecting") && !hasVideo ? (
          <div className="voice-participant-grid" aria-label="Call participants">
            {callParticipants.map((participant) => {
              const speaking = activeSpeakerIds.has(participant.identity) || (participant.local && localSpeaking);
              return (
                <article key={participant.identity} className={`voice-participant ${speaking ? "is-speaking" : ""}`} onClick={() => onViewProfile?.(participant.identity)}>
                  <div className="participant-avatar-wrap">
                    <span className="participant-avatar">{participant.avatarUrl ? <img src={participant.avatarUrl} alt="" /> : participant.name.slice(0, 1).toUpperCase()}</span>
                  </div>
                  <strong>{participant.name}{participant.local ? " (you)" : ""}</strong>
                  <div className="participant-media-status" aria-label={`${participant.name}: ${participant.microphoneMuted ? "microphone muted" : "microphone on"}${participant.deafened ? ", sound muted" : ""}`}>
                    {participant.microphoneMuted ? <span><Icon name="microphoneOff" size={14} /> Muted</span> : null}
                    {participant.deafened ? <span><Icon name="headphonesOff" size={14} /> Deafened</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        <div className={`video-grid layout-${layoutMode} ${pinnedTileId ? "has-pinned-tile" : ""} ${hasScreenShare ? "has-screen-share" : ""} ${!hasVideo ? "is-empty" : ""}`} style={videoGridStyle} aria-label="Channel videos">
          <div ref={localScreenRef} className={`local-video local-screen ${pinnedTileId === "local-screen" ? "is-pinned" : ""} ${localSpeaking ? "is-speaking" : ""}`} data-participant-id={currentUser.id} onClick={() => screenShareEnabled && setPinnedTileId((value) => value === "local-screen" ? null : "local-screen")} />
          <div ref={localCameraRef} className={`local-video ${pinnedTileId === "local-camera" ? "is-pinned" : ""} ${localSpeaking ? "is-speaking" : ""}`} data-participant-id={currentUser.id} onClick={() => cameraEnabled && setPinnedTileId((value) => value === "local-camera" ? null : "local-camera")} />
          <div ref={remoteVideoRef} className="remote-videos" />
        </div>
        {hasVideo && !hideAudioOnly && audioOnlyParticipants.length > 0 ? <div className="voice-audio-strip">{audioOnlyParticipants.map((participant) => <button type="button" key={participant.identity} onClick={() => onViewProfile?.(participant.identity)}><span className={`member-avatar ${activeSpeakerIds.has(participant.identity) ? "is-speaking" : ""}`}>{participant.avatarUrl ? <img src={participant.avatarUrl} alt="" /> : participant.name[0].toUpperCase()}</span><span>{participant.name}{participant.local ? " (you)" : ""}</span><span className="voice-media-status" aria-label={`${participant.name}: ${participant.microphoneMuted ? "microphone muted" : "microphone on"}${participant.deafened ? ", sound muted" : ""}`}>{participant.microphoneMuted ? <Icon name="microphoneOff" size={14} /> : null}{participant.deafened ? <Icon name="headphonesOff" size={14} /> : null}</span></button>)}</div> : null}
        {screenAudioParticipants.length > 0 ? (
          <div className="screen-audio-mixer" aria-label="Screen share audio controls">
            {screenAudioParticipants.map((participant) => {
              const volume = screenAudioVolumes[participant.identity] ?? 100;
              return <label key={participant.trackSid}><span><Icon name="volume" size={15} /> {participant.name}</span><input type="range" min={0} max={100} step={5} value={volume} aria-label={`${participant.name} screen share volume`} onChange={(event) => setScreenAudioVolume(participant.identity, Number(event.target.value))} /><small>{volume}%</small></label>;
            })}
          </div>
        ) : null}
        {status === "idle" ? (
          <button type="button" className="voice-primary" onClick={() => void joinRoom()}>
            Join
          </button>
        ) : status === "connecting" ? (
          <button type="button" className="voice-primary connecting" disabled>Connecting<span className="connecting-dots" aria-hidden="true"><i /><i /><i /></span></button>
        ) : (
          <>
          <div className="voice-controls" aria-label="Voice channel controls">
            <button type="button" title={microphoneEnabled ? "Mute microphone" : "Unmute microphone"} aria-label={settings.pushToTalk ? (microphoneEnabled ? "You're talking…" : "Hold Space") : (microphoneEnabled ? "Mute microphone" : "Unmute microphone")} className={!microphoneEnabled ? "control-off" : ""} onClick={() => void toggleMicrophone()}>
              <Icon name="microphone" size={19} />
            </button>
            <button type="button" title={deafened ? "Undeafen" : "Deafen"} aria-label={deafened ? "Undeafen" : "Deafen"} className={deafened ? "control-off" : ""} aria-pressed={deafened} onClick={() => void toggleDeafen()}>
              <Icon name="headphones" size={19} />
            </button>
            <button type="button" title={cameraEnabled ? "Stop camera" : "Turn on camera"} aria-label={cameraEnabled ? "Stop camera" : "Turn on camera"} className={!cameraEnabled ? "control-off" : ""} aria-pressed={cameraEnabled} onClick={() => void toggleCamera()}>
              <Icon name={cameraEnabled ? "cameraOff" : "camera"} size={19} />
            </button>
            <button type="button" title={screenShareEnabled ? "Stop sharing" : "Share screen"} aria-label={screenShareEnabled ? "Stop sharing" : "Share screen"} className={!screenShareEnabled ? "control-off" : ""} aria-pressed={screenShareEnabled} onClick={() => void toggleScreenShare()}>
              <Icon name={screenShareEnabled ? "monitorOff" : "monitor"} size={19} />
            </button>
            <button type="button" title="Settings" aria-label="Settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
              <Icon name="settings" size={19} />
            </button>
            <button type="button" title="Leave" aria-label="Leave" className="voice-danger" onClick={() => void leaveRoom()}>
              <Icon name="phone" size={20} />
            </button>
          </div>
          </>
        )}
      </div>
      {settingsOpen ? (
        <div
          className="voice-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section className="voice-settings-modal" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">
            <header>
              <div>
                <span>USER SETTINGS</span>
                <h2 id="voice-settings-title">Voice & Video</h2>
              </div>
              <button type="button" className="modal-close" aria-label="Close settings" autoFocus onClick={() => setSettingsOpen(false)}>
                <Icon name="close" size={20} />
              </button>
            </header>
            <div className="voice-settings-content">
              <div className="settings-section">
                <h3>Devices</h3>
                <div className="voice-settings">
                  <DeviceSelect label="Microphone" kind="audioinput" devices={devices} value={settings.devices.audioinput} onChange={selectDevice} />
                  <DeviceSelect label="Audio output" kind="audiooutput" devices={devices} value={settings.devices.audiooutput} onChange={selectDevice} />
                  <DeviceSelect label="Camera" kind="videoinput" devices={devices} value={settings.devices.videoinput} onChange={selectDevice} />
                </div>
              </div>
              <div className="settings-section">
                <h3>Streaming quality</h3>
                <div className="voice-settings">
                  <QualitySelect label="Audio" value={settings.audioQuality} profiles={audioProfiles} onChange={(quality) => selectQuality("audio", quality)} />
                  <QualitySelect label="Webcam" value={settings.cameraQuality} profiles={cameraProfiles} onChange={(quality) => selectQuality("camera", quality)} />
                  <QualitySelect<ScreenQuality> label="Screen share" value={settings.screenQuality} profiles={screenProfiles} onChange={(quality) => selectQuality("screen", quality)} />
                  <p className="form-hint">To share game, tab, or system audio, enable audio in your browser's sharing picker.</p>
                </div>
              </div>
              <div className="settings-section">
                <h3>Input mode</h3>
                <div className="input-mode-options" role="radiogroup" aria-label="Audio input mode">
                  <button type="button" role="radio" aria-checked={!settings.pushToTalk} className={!settings.pushToTalk ? "active" : ""} onClick={() => settings.pushToTalk && void togglePushToTalk()}>
                    <span>Voice detection</span>
                    <small>The microphone activates automatically based on the chosen threshold.</small>
                  </button>
                  <button type="button" role="radio" aria-checked={settings.pushToTalk} className={settings.pushToTalk ? "active" : ""} onClick={() => !settings.pushToTalk && void togglePushToTalk()}>
                    <span>Push-to-talk</span>
                    <small>Hold the Space bar to talk.</small>
                  </button>
                </div>
              </div>
              <div className="settings-section voice-detection-section">
                <div className="settings-section-heading">
                  <div><h3>Input sensitivity</h3><p>Adjust the level needed to detect your voice.</p></div>
                  <strong>{Math.round(settings.vadThreshold * 100)} %</strong>
                </div>
                <div className="voice-meter" aria-label={`Microphone level ${Math.round(audioLevel * 100)} %`}>
                  <span style={{ width: `${Math.min(audioLevel * 100, 100)}%` }} />
                  <i style={{ left: `${settings.vadThreshold * 100}%` }} />
                </div>
                <input aria-label="Voice threshold" type="range" min="0.02" max="0.6" step="0.01" value={settings.vadThreshold} onChange={(event) => saveSettings({ ...settings, vadThreshold: Number(event.target.value) })} />
              </div>
            </div>
          </section>
        </div>
      ) : null}
      <div ref={audioRef} className="remote-audio" aria-hidden="true" />
    </section>
  );
}

function QualitySelect<TQuality extends string = MediaQuality>({
  label,
  value,
  profiles,
  onChange,
}: {
  label: string;
  value: TQuality;
  profiles: Record<TQuality, QualityProfile<unknown>>;
  onChange(value: TQuality): void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as TQuality)}>
        {(Object.entries(profiles) as [TQuality, QualityProfile<unknown>][]).map(([key, profile]) => (
          <option key={key} value={key}>{profile.label} — {profile.detail}</option>
        ))}
      </select>
    </label>
  );
}

function DeviceSelect({
  label,
  kind,
  devices,
  value,
  onChange,
}: {
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value?: string;
  onChange(kind: MediaDeviceKind, deviceId: string): Promise<void>;
}) {
  const matching = devices.filter((device) => device.kind === kind);
  if (matching.length === 0) return null;
  return (
    <label>
      {label}
      <select value={value ?? ""} onChange={(event) => void onChange(kind, event.target.value)}>
        <option value="">Default</option>
        {matching.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>
        ))}
      </select>
    </label>
  );
}
