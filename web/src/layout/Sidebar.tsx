import { useState, type FormEvent } from "react";
import type { Channel, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";
import type { VoiceParticipant } from "../ws/protocol";
import { Icon } from "../ui/Icon";
import { AdminPanel } from "./AdminPanel";
import { ChannelSettingsModal } from "./ChannelSettingsModal";

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
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const editingChannel = channels.find((c) => c.id === editingChannelId) ?? null;
  const canManageChannels = currentUser.capabilities.includes("manage_channels");
  const canManageServer = currentUser.capabilities.includes("manage_server");

  return (
    <nav className="sidebar" aria-label="Channels">
      <div className="sidebar-server-name">
        <span>Vocal</span>
        <span className="online-dot" aria-label={`${onlineUserIds.length} members online`} />
      </div>
      <ChannelGroup
        title="Text channels"
        channels={textChannels}
        voiceOccupancy={voiceOccupancy}
        currentUserId={currentUser.id}
        selectedChannelId={selectedChannelId}
        onSelectChannel={onSelectChannel}
        onEditChannel={canManageChannels ? setEditingChannelId : undefined}
      />
      <ChannelGroup
        title="Voice channels"
        channels={voiceChannels}
        voiceOccupancy={voiceOccupancy}
        currentUserId={currentUser.id}
        selectedChannelId={selectedChannelId}
        onSelectChannel={onSelectChannel}
        onEditChannel={canManageChannels ? setEditingChannelId : undefined}
      />
      <p className="sidebar-presence"><span className="online-dot" /> {onlineUserIds.length} online</p>
      {canManageServer && (
        <button type="button" className="server-settings-button" onClick={() => setAdminOpen(true)}><Icon name="settings" size={15} /> Server settings</button>
      )}
      {canManageChannels && (
        <CreateChannelForm
          onCreated={onChannelCreated}
          onError={() => showToast("Could not create the channel")}
        />
      )}
      {adminOpen ? <AdminPanel currentUser={currentUser} onClose={() => setAdminOpen(false)} /> : null}
      {editingChannel ? (
        <ChannelSettingsModal
          channel={editingChannel}
          onUpdated={(channel) => { onChannelUpdated?.(channel); setEditingChannelId(null); }}
          onDeleted={(channelId) => { onChannelDeleted?.(channelId); setEditingChannelId(null); }}
          onClose={() => setEditingChannelId(null)}
        />
      ) : null}
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
  onEditChannel,
}: {
  title: string;
  channels: Channel[];
  voiceOccupancy: Record<string, VoiceParticipant[]>;
  currentUserId: string;
  selectedChannelId: string | null;
  onSelectChannel(channelId: string): void;
  onEditChannel?(channelId: string): void;
}) {
  if (channels.length === 0) return null;
  return (
    <section className="channel-group">
      <h2><Icon name="chevron" size={13} /> {title}</h2>
      <ul>
        {channels.map((channel) => {
          const occupants = voiceOccupancy[channel.id] ?? [];
          return <li key={channel.id}>
            <div className="channel-row">
              <button
                type="button"
                className={channel.id === selectedChannelId ? "channel-link active" : "channel-link"}
                onClick={() => onSelectChannel(channel.id)}
              >
                <span className="channel-icon" aria-hidden="true"><Icon name={channel.type === "voice" ? "volume" : "hash"} /></span>
                <span className="channel-name">{channel.name}</span>
              </button>
              {onEditChannel ? (
                <button
                  type="button"
                  className="channel-settings-button"
                  aria-label={`Settings for ${channel.name}`}
                  title={`Settings for ${channel.name}`}
                  onClick={() => onEditChannel(channel.id)}
                >
                  <Icon name="settings" size={14} />
                </button>
              ) : null}
            </div>
            {channel.type === "voice" && occupants.length > 0 && (
              <ul className="voice-occupants" aria-label={`Participants in ${channel.name}`}>
                {occupants.map((participant) => (
                  <li key={participant.userId}>
                    <span className="member-avatar">{participant.username.slice(0, 1).toUpperCase()}</span>
                    {participant.userId === currentUserId ? `${participant.username} (you)` : participant.username}
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
      <summary><Icon name="plus" size={15} /> Create a channel</summary>
      <form onSubmit={handleSubmit}>
      <input
        aria-label="New channel name"
        placeholder="new-channel"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        aria-label="Channel type"
        value={type}
        onChange={(e) => setType(e.target.value as Channel["type"])}
      >
        <option value="text">Text</option>
        <option value="voice">Voice</option>
      </select>
      <button type="submit" disabled={submitting}>
        + Add
      </button>
      </form>
    </details>
  );
}
