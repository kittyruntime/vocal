import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication } from "livekit-client";
import type { Channel, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";

type VoiceStatus = "idle" | "connecting" | "connected";

export function VoiceView({ channel, currentUser }: { channel: Channel; currentUser: CurrentUser }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);

  async function leaveRoom() {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    if (audioRef.current) audioRef.current.replaceChildren();
    setStatus("idle");
    setMicrophoneEnabled(false);
  }

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.disconnect();
    };
  }, [channel.id]);

  async function joinRoom() {
    if (status !== "idle") return;
    setStatus("connecting");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) audioRef.current?.append(track.attach());
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      for (const element of track.detach()) element.remove();
    });
    room.on(RoomEvent.Disconnected, () => {
      if (roomRef.current === room) {
        roomRef.current = null;
        setStatus("idle");
        setMicrophoneEnabled(false);
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

  return (
    <section className="voice-view" aria-label={`Salon vocal ${channel.name}`}>
      <header className="chat-header">🔊 {channel.name}</header>
      <div className="voice-stage">
        <h1>{channel.name}</h1>
        <p>{status === "connected" ? `Connecté en tant que ${currentUser.username}` : "Rejoignez le salon pour parler."}</p>
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
