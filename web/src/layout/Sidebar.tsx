import { useState, type FormEvent } from "react";
import type { Channel, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";
import type { VoiceParticipant } from "../ws/protocol";
import { Icon } from "../ui/Icon";
import { AdminPanel } from "./AdminPanel";

export function Sidebar({
  channels,
  selectedChannelId,
  onlineUserIds,
  voiceOccupancy,
  currentUser,
  onSelectChannel,
  onChannelCreated,
  onChannelUpdated,
  onChannelDeleted,
}: {
  channels: Channel[];
  selectedChannelId: string | null;
  onlineUserIds: string[];
  voiceOccupancy: Record<string, VoiceParticipant[]>;
  currentUser: CurrentUser;
  onSelectChannel(channelId: string): void;
  onChannelCreated(channel: Channel): void;
  onChannelUpdated?(channel: Channel): void;
  onChannelDeleted?(channelId: string): void;
}) {
  const { showToast } = useToast();
  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");
  const [adminOpen, setAdminOpen] = useState(false);

  return (
    <nav className="sidebar" aria-label="Channels">
      <div className="sidebar-server-name">
        <span>Vocal</span>
        <span className="online-dot" aria-label={`${onlineUserIds.length} membres en ligne`} />
      </div>
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
      <p className="sidebar-presence"><span className="online-dot" /> {onlineUserIds.length} en ligne</p>
      {currentUser.role === "admin" && (
        <><button type="button" className="server-settings-button" onClick={() => setAdminOpen(true)}><Icon name="settings" size={15} /> Paramètres du serveur</button><CreateChannelForm
          onCreated={onChannelCreated}
          onError={() => showToast("Impossible de créer le channel")}
        />{adminOpen ? <AdminPanel channels={channels} currentUser={currentUser} onChannelUpdated={onChannelUpdated ?? (() => {})} onChannelDeleted={onChannelDeleted ?? (() => {})} onClose={() => setAdminOpen(false)} /> : null}</>
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
    <section className="channel-group">
      <h2><Icon name="chevron" size={13} /> {title}</h2>
      <ul>
        {channels.map((channel) => {
          const occupants = voiceOccupancy[channel.id] ?? [];
          return <li key={channel.id}>
            <button
              type="button"
              className={channel.id === selectedChannelId ? "channel-link active" : "channel-link"}
              onClick={() => onSelectChannel(channel.id)}
            >
              <span className="channel-icon" aria-hidden="true"><Icon name={channel.type === "voice" ? "volume" : "hash"} /></span>
              <span className="channel-name">{channel.name}</span>
            </button>
            {channel.type === "voice" && occupants.length > 0 && (
              <ul className="voice-occupants" aria-label={`Participants dans ${channel.name}`}>
                {occupants.map((participant) => (
                  <li key={participant.userId}>
                    <span className="member-avatar">{participant.username.slice(0, 1).toUpperCase()}</span>
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
    <details className="create-channel">
      <summary><Icon name="plus" size={15} /> Créer un salon</summary>
      <form onSubmit={handleSubmit}>
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
    </details>
  );
}
