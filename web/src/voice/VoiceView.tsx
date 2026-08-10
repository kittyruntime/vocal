import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
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

export function VoiceView({ channel, currentUser }: { channel: Channel; currentUser: CurrentUser }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const localCameraRef = useRef<HTMLDivElement>(null);
  const localScreenRef = useRef<HTMLDivElement>(null);
  const deafenedRef = useRef(false);
  const activeSpeakersRef = useRef(new Set<string>());

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
  }

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.disconnect();
      clearMedia();
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
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicrophoneEnabled(true);
      setStatus("connected");
    } catch {
      await room.disconnect();
      if (roomRef.current === room) roomRef.current = null;
      setStatus("idle");
      setMicrophoneEnabled(false);
      showToast("Impossible de rejoindre le salon vocal");
    }
  }

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
      <header className="chat-header">🔊 {channel.name}</header>
      <div className="voice-stage">
        <h1>{channel.name}</h1>
        <p>{status === "connected" ? `Connecté en tant que ${currentUser.username}` : "Rejoignez le salon pour parler."}</p>
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
          <div className="voice-controls">
            <button type="button" onClick={() => void toggleMicrophone()}>
              {microphoneEnabled ? "Couper le micro" : "Rétablir le micro"}
            </button>
            <button type="button" aria-pressed={deafened} onClick={toggleDeafen}>
              {deafened ? "Rétablir le son" : "Assourdir"}
            </button>
            <button type="button" aria-pressed={cameraEnabled} onClick={() => void toggleCamera()}>
              {cameraEnabled ? "Arrêter la caméra" : "Activer la caméra"}
            </button>
            <button type="button" aria-pressed={screenShareEnabled} onClick={() => void toggleScreenShare()}>
              {screenShareEnabled ? "Arrêter le partage" : "Partager l’écran"}
            </button>
            <button type="button" className="voice-danger" onClick={() => void leaveRoom()}>
              Quitter
            </button>
          </div>
        )}
      </div>
      <div ref={audioRef} className="remote-audio" aria-hidden="true" />
    </section>
  );
}
