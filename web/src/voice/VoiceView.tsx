import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createAudioAnalyser,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import type { Channel, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";

type VoiceStatus = "idle" | "connecting" | "connected";
type DeviceSelections = Partial<Record<MediaDeviceKind, string>>;

const SETTINGS_KEY = "vocal.voice-settings.v1";

function loadSettings(): { devices: DeviceSelections; vadThreshold: number; pushToTalk: boolean } {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as {
      devices?: DeviceSelections; vadThreshold?: number; pushToTalk?: boolean;
    };
    return {
      devices: parsed.devices ?? {},
      vadThreshold: typeof parsed.vadThreshold === "number" ? parsed.vadThreshold : 0.15,
      pushToTalk: parsed.pushToTalk === true,
    };
  } catch {
    return { devices: {}, vadThreshold: 0.15, pushToTalk: false };
  }
}

export function VoiceView({ channel, currentUser }: { channel: Channel; currentUser: CurrentUser }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [settings, setSettings] = useState(loadSettings);
  const [audioLevel, setAudioLevel] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const localCameraRef = useRef<HTMLDivElement>(null);
  const localScreenRef = useRef<HTMLDivElement>(null);
  const deafenedRef = useRef(false);
  const activeSpeakersRef = useRef(new Set<string>());
  const meterCleanupRef = useRef<(() => Promise<void>) | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const pttPressedRef = useRef(false);

  function saveSettings(next: typeof settings) {
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  function stopMeter() {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    const cleanup = meterCleanupRef.current;
    meterCleanupRef.current = null;
    if (cleanup) void cleanup();
    setAudioLevel(0);
  }

  function startMeter(track: LocalAudioTrack) {
    stopMeter();
    try {
      const analyser = createAudioAnalyser(track, { cloneTrack: true, smoothingTimeConstant: 0.7 });
      meterCleanupRef.current = analyser.cleanup;
      const update = () => {
        setAudioLevel(analyser.calculateVolume());
        meterFrameRef.current = requestAnimationFrame(update);
      };
      update();
    } catch {
      // The audio call remains usable on browsers without Web Audio support.
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
      }
    }
  }

  function clearMedia() {
    audioRef.current?.replaceChildren();
    remoteVideoRef.current?.replaceChildren();
    localCameraRef.current?.replaceChildren();
    localScreenRef.current?.replaceChildren();
  }

  async function leaveRoom() {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    clearMedia();
    setStatus("idle");
    setMicrophoneEnabled(false);
    setDeafened(false);
    deafenedRef.current = false;
    setCameraEnabled(false);
    setScreenShareEnabled(false);
    activeSpeakersRef.current.clear();
    stopMeter();
  }

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.disconnect();
      clearMedia();
      stopMeter();
    };
  }, [channel.id]);

  async function joinRoom() {
    if (status !== "idle") return;
    setStatus("connecting");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach();
          element.muted = deafenedRef.current;
          audioRef.current?.append(element);
          return;
        }
        if (track.kind === Track.Kind.Video) {
          const tile = document.createElement("figure");
          tile.className = publication.source === Track.Source.ScreenShare ? "video-tile screen-share" : "video-tile";
          tile.dataset.trackSid = track.sid;
          tile.dataset.participantId = participant.identity;
          tile.classList.toggle("is-speaking", activeSpeakersRef.current.has(participant.identity));
          const element = track.attach();
          element.setAttribute("playsinline", "");
          const label = document.createElement("figcaption");
          label.textContent = participant.name || participant.identity;
          tile.append(element, label);
          remoteVideoRef.current?.append(tile);
        }
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      for (const element of track.detach()) element.remove();
      for (const child of remoteVideoRef.current?.children ?? []) {
        if ((child as HTMLElement).dataset.trackSid === track.sid) child.remove();
      }
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
      updateSpeakingTiles(new Set(speakers.map((participant) => participant.identity)));
    });
    room.on(RoomEvent.Disconnected, () => {
      if (roomRef.current === room) {
        roomRef.current = null;
        setStatus("idle");
        setMicrophoneEnabled(false);
        setCameraEnabled(false);
        setScreenShareEnabled(false);
        clearMedia();
      }
    });

    try {
      const { token, url } = await api.getVoiceToken(channel.id);
      await room.connect(url, token);
      for (const [kind, deviceId] of Object.entries(settings.devices)) {
        if (deviceId) await room.switchActiveDevice(kind as MediaDeviceKind, deviceId, false);
      }
      const microphone = await room.localParticipant.setMicrophoneEnabled(!settings.pushToTalk);
      setMicrophoneEnabled(!settings.pushToTalk);
      if (microphone?.audioTrack) startMeter(microphone.audioTrack);
      setDevices(await Room.getLocalDevices(undefined, false));
      setStatus("connected");
    } catch (error) {
      await room.disconnect();
      if (roomRef.current === room) roomRef.current = null;
      setStatus("idle");
      setMicrophoneEnabled(false);
      stopMeter();
      const message = error instanceof api.ApiError
        ? error.message === "not a voice channel"
          ? "Ce salon n’est pas un salon vocal"
          : `Connexion vocale refusée : ${error.message}`
        : "Impossible de rejoindre le salon vocal";
      showToast(message);
    }
  }

  async function selectDevice(kind: MediaDeviceKind, deviceId: string) {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.switchActiveDevice(kind, deviceId);
      saveSettings({ ...settings, devices: { ...settings.devices, [kind]: deviceId } });
    } catch {
      showToast("Impossible de changer de périphérique");
    }
  }

  async function togglePushToTalk() {
    const room = roomRef.current;
    if (!room) return;
    const enabled = !settings.pushToTalk;
    saveSettings({ ...settings, pushToTalk: enabled });
    pttPressedRef.current = false;
    try {
      await room.localParticipant.setMicrophoneEnabled(!enabled);
      setMicrophoneEnabled(!enabled);
    } catch {
      showToast("Impossible d’activer le push-to-talk");
    }
  }

  useEffect(() => {
    if (status !== "connected" || !settings.pushToTalk) return;
    const setPressed = (pressed: boolean) => {
      if (pttPressedRef.current === pressed) return;
      pttPressedRef.current = pressed;
      const room = roomRef.current;
      if (!room) return;
      void room.localParticipant.setMicrophoneEnabled(pressed).then(() => {
        setMicrophoneEnabled(pressed);
      }).catch(() => showToast("Impossible de modifier le microphone"));
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
  }, [settings.pushToTalk, showToast, status]);

  async function toggleMicrophone() {
    const room = roomRef.current;
    if (!room || status !== "connected") return;
    const enabled = !microphoneEnabled;
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
      setMicrophoneEnabled(enabled);
    } catch {
      showToast("Impossible de modifier le microphone");
    }
  }

  function toggleDeafen() {
    const next = !deafened;
    deafenedRef.current = next;
    setDeafened(next);
    for (const element of audioRef.current?.querySelectorAll("audio") ?? []) {
      element.muted = next;
    }
  }

  async function toggleCamera() {
    const room = roomRef.current;
    if (!room || status !== "connected") return;
    const enabled = !cameraEnabled;
    const previousTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    try {
      const publication = await room.localParticipant.setCameraEnabled(enabled);
      localCameraRef.current?.replaceChildren();
      if (enabled && publication?.track) {
        const element = publication.track.attach();
        element.muted = true;
        element.setAttribute("playsinline", "");
        localCameraRef.current?.append(element);
      } else if (!enabled && previousTrack) {
        for (const element of previousTrack.detach()) element.remove();
      }
      setCameraEnabled(enabled);
    } catch {
      showToast("Impossible de modifier la caméra");
    }
  }

  async function toggleScreenShare() {
    const room = roomRef.current;
    if (!room || status !== "connected") return;
    const enabled = !screenShareEnabled;
    const previousTrack = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    try {
      const publication = await room.localParticipant.setScreenShareEnabled(enabled);
      localScreenRef.current?.replaceChildren();
      if (enabled && publication?.track) {
        const element = publication.track.attach();
        element.muted = true;
        element.setAttribute("playsinline", "");
        localScreenRef.current?.append(element);
      } else if (!enabled && previousTrack) {
        for (const element of previousTrack.detach()) element.remove();
      }
      setScreenShareEnabled(enabled);
    } catch {
      showToast("Impossible de partager l’écran");
    }
  }

  return (
    <section className="voice-view" aria-label={`Salon vocal ${channel.name}`}>
      <header className="chat-header"><span className="header-channel-icon">◖))</span> {channel.name}</header>
      <div className="voice-stage">
        <div className="voice-hero">
          <div className="voice-hero-icon">◖))</div>
          <h1>{channel.name}</h1>
          <p>{status === "connected" ? `Connecté en tant que ${currentUser.username}` : "Rejoignez le salon pour parler, partager votre caméra ou votre écran."}</p>
        </div>
        <div className="video-grid" aria-label="Vidéos du salon">
          <div ref={localScreenRef} className="local-video local-screen" data-participant-id={currentUser.id} />
          <div ref={localCameraRef} className="local-video" data-participant-id={currentUser.id} />
          <div ref={remoteVideoRef} className="remote-videos" />
        </div>
        {status === "idle" ? (
          <button type="button" className="voice-primary" onClick={() => void joinRoom()}>
            Rejoindre
          </button>
        ) : status === "connecting" ? (
          <button type="button" className="voice-primary" disabled>Connexion…</button>
        ) : (
          <>
          <details className="voice-settings-panel">
            <summary>⚙ Réglages audio et vidéo</summary>
            <div className="voice-meter" aria-label={`Niveau du microphone ${Math.round(audioLevel * 100)} %`}>
              <span style={{ width: `${Math.min(audioLevel * 100, 100)}%` }} />
              <i style={{ left: `${settings.vadThreshold * 100}%` }} />
            </div>
            <div className="voice-settings">
            <DeviceSelect
              label="Microphone"
              kind="audioinput"
              devices={devices}
              value={settings.devices.audioinput}
              onChange={selectDevice}
            />
            <DeviceSelect
              label="Caméra"
              kind="videoinput"
              devices={devices}
              value={settings.devices.videoinput}
              onChange={selectDevice}
            />
            <DeviceSelect
              label="Sortie audio"
              kind="audiooutput"
              devices={devices}
              value={settings.devices.audiooutput}
              onChange={selectDevice}
            />
            <label>
              Seuil vocal
              <input
                aria-label="Seuil vocal"
                type="range"
                min="0.02"
                max="0.6"
                step="0.01"
                value={settings.vadThreshold}
                onChange={(event) => saveSettings({ ...settings, vadThreshold: Number(event.target.value) })}
              />
            </label>
            </div>
          </details>
          <div className="voice-controls" aria-label="Contrôles du salon vocal">
            <button type="button" className={!microphoneEnabled ? "control-off" : ""} onClick={() => void toggleMicrophone()}>
              {settings.pushToTalk ? (microphoneEnabled ? "Vous parlez…" : "Maintenez Espace") : (microphoneEnabled ? "Couper le micro" : "Rétablir le micro")}
            </button>
            <button type="button" aria-pressed={settings.pushToTalk} onClick={() => void togglePushToTalk()}>
              {settings.pushToTalk ? "Désactiver PTT" : "Activer PTT"}
            </button>
            <button type="button" className={deafened ? "control-off" : ""} aria-pressed={deafened} onClick={toggleDeafen}>
              {deafened ? "Rétablir le son" : "Assourdir"}
            </button>
            <button type="button" className={!cameraEnabled ? "control-off" : ""} aria-pressed={cameraEnabled} onClick={() => void toggleCamera()}>
              {cameraEnabled ? "Arrêter la caméra" : "Activer la caméra"}
            </button>
            <button type="button" className={!screenShareEnabled ? "control-off" : ""} aria-pressed={screenShareEnabled} onClick={() => void toggleScreenShare()}>
              {screenShareEnabled ? "Arrêter le partage" : "Partager l’écran"}
            </button>
            <button type="button" className="voice-danger" onClick={() => void leaveRoom()}>
              Quitter
            </button>
          </div>
          </>
        )}
      </div>
      <div ref={audioRef} className="remote-audio" aria-hidden="true" />
    </section>
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
        <option value="">Par défaut</option>
        {matching.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>
        ))}
      </select>
    </label>
  );
}
