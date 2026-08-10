import { useState, type FormEvent } from "react";
import type { Channel, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";
import type { VoiceParticipant } from "../ws/protocol";

export function Sidebar({
  channels,
  selectedChannelId,
  onlineUserIds,
  voiceOccupancy,
  currentUser,
  onSelectChannel,
  onChannelCreated,
}: {
  channels: Channel[];
  selectedChannelId: string | null;
  onlineUserIds: string[];
  voiceOccupancy: Record<string, VoiceParticipant[]>;
  currentUser: CurrentUser;
  onSelectChannel(channelId: string): void;
  onChannelCreated(channel: Channel): void;
}) {
  const { showToast } = useToast();
  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  return (
    <nav className="sidebar" aria-label="Channels">
      <ChannelGroup
        title="Salons textuels"
        channels={textChannels}
        voiceOccupancy={voiceOccupancy}
        currentUserId={currentUser.id}
        selectedChannelId={selectedChannelId}
        onSelectChannel={onSelectChannel}
      />
      <ChannelGroup
        title="Salons vocaux"
        channels={voiceChannels}
        voiceOccupancy={voiceOccupancy}
        currentUserId={currentUser.id}
        selectedChannelId={selectedChannelId}
        onSelectChannel={onSelectChannel}
      />
      <p className="sidebar-presence">{onlineUserIds.length} en ligne</p>
      {currentUser.role === "admin" && (
        <CreateChannelForm
          onCreated={onChannelCreated}
          onError={() => showToast("Impossible de créer le channel")}
        />
      )}
    </nav>
  );
}

function ChannelGroup({
  title,
  channels,
  voiceOccupancy,
  currentUserId,
  selectedChannelId,
  onSelectChannel,
}: {
  title: string;
  channels: Channel[];
  voiceOccupancy: Record<string, VoiceParticipant[]>;
  currentUserId: string;
  selectedChannelId: string | null;
  onSelectChannel(channelId: string): void;
}) {
  if (channels.length === 0) return null;
  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {channels.map((channel) => {
          const occupants = voiceOccupancy[channel.id] ?? [];
          return <li key={channel.id}>
            <button
              type="button"
              className={channel.id === selectedChannelId ? "channel-link active" : "channel-link"}
              onClick={() => onSelectChannel(channel.id)}
            >
              {channel.type === "voice" ? "🔊" : "#"} {channel.name}
            </button>
            {channel.type === "voice" && occupants.length > 0 && (
              <ul className="voice-occupants" aria-label={`Participants dans ${channel.name}`}>
                {occupants.map((participant) => (
                  <li key={participant.userId}>
                    {participant.userId === currentUserId ? `${participant.username} (vous)` : participant.username}
                  </li>
                ))}
              </ul>
            )}
          </li>;
        })}
      </ul>
    </section>
  );
}

function CreateChannelForm({
  onCreated,
  onError,
}: {
  onCreated(channel: Channel): void;
  onError(): void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Channel["type"]>("text");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const channel = await api.createChannel({ name: trimmed, type });
      onCreated(channel);
      setName("");
    } catch {
      onError();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="create-channel" onSubmit={handleSubmit}>
      <input
        aria-label="Nom du nouveau channel"
        placeholder="nouveau-channel"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        aria-label="Type de channel"
        value={type}
        onChange={(e) => setType(e.target.value as Channel["type"])}
      >
        <option value="text">Textuel</option>
        <option value="voice">Vocal</option>
      </select>
      <button type="submit" disabled={submitting}>
        + Ajouter
      </button>
    </form>
  );
}
