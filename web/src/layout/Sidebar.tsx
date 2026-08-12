import { useState, type FormEvent } from "react";
import type { Capability, Channel, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";
import type { VoiceParticipant } from "../ws/protocol";
import { Icon } from "../ui/Icon";
import { AdminPanel } from "./AdminPanel";
import { ChannelSettingsModal } from "./ChannelSettingsModal";

const CAPABILITY_LABEL: Record<Capability, string> = {
  manage_channels: "Channel managers only",
  manage_server: "Server managers only",
  moderate: "Moderators only",
  publish_voice: "Voice members only",
};

export function Sidebar({
  channels,
  selectedChannelId,
  onlineUserIds,
  voiceOccupancy,
  voiceSpeakingUserIds,
  unreadChannelIds,
  unreadCounts,
  mentionChannelIds,
  currentUser,
  onSelectChannel,
  onChannelCreated,
  onChannelUpdated,
  onChannelDeleted,
  onViewProfile,
  onOpenSearch,
}: {
  channels: Channel[];
  selectedChannelId: string | null;
  onlineUserIds: string[];
  voiceOccupancy: Record<string, VoiceParticipant[]>;
  voiceSpeakingUserIds?: string[];
  unreadChannelIds?: string[];
  unreadCounts?: Record<string, number>;
  mentionChannelIds?: string[];
  currentUser: CurrentUser;
  onSelectChannel(channelId: string): void;
  onChannelCreated(channel: Channel): void;
  onChannelUpdated?(channel: Channel): void;
  onChannelDeleted?(channelId: string): void;
  onViewProfile?(userId: string): void;
  onOpenSearch?(): void;
}) {
  const { showToast } = useToast();
  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");
  const [adminOpen, setAdminOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const editingChannel = channels.find((c) => c.id === editingChannelId) ?? null;
  const canManageChannels = currentUser.capabilities.includes("manage_channels");
  const canManageServer = currentUser.capabilities.includes("manage_server");
  const canModerate = currentUser.capabilities.includes("moderate");

  return (
    <nav className="sidebar" aria-label="Channels">
      <div className="sidebar-server-name">
        <span>Vocal</span>
        <div className="sidebar-server-actions">
          <button type="button" className="server-settings-button" aria-label="Search" title="Search" onClick={onOpenSearch}><Icon name="search" size={17} /></button>
          <span className="online-dot" aria-label={`${onlineUserIds.length} members online`} />
          {(canManageServer || canModerate) ? <button type="button" className="server-settings-button" aria-label={canManageServer ? "Server settings" : "Moderation"} title={canManageServer ? "Server settings" : "Moderation"} onClick={() => setAdminOpen(true)}><Icon name="settings" size={17} /></button> : null}
        </div>
      </div>
      <ChannelGroup
        title="Text channels"
        channels={textChannels}
        voiceOccupancy={voiceOccupancy}
        currentUserId={currentUser.id}
        selectedChannelId={selectedChannelId}
        unreadChannelIds={unreadChannelIds}
        unreadCounts={unreadCounts}
        mentionChannelIds={mentionChannelIds}
        onSelectChannel={onSelectChannel}
        onEditChannel={canManageChannels ? setEditingChannelId : undefined}
        onViewProfile={onViewProfile}
      />
      <ChannelGroup
        title="Voice channels"
        channels={voiceChannels}
        voiceOccupancy={voiceOccupancy}
        voiceSpeakingUserIds={voiceSpeakingUserIds}
        currentUserId={currentUser.id}
        selectedChannelId={selectedChannelId}
        unreadChannelIds={unreadChannelIds}
        onSelectChannel={onSelectChannel}
        onEditChannel={canManageChannels ? setEditingChannelId : undefined}
        onViewProfile={onViewProfile}
      />
      <p className="sidebar-presence"><span className="online-dot" /> {onlineUserIds.length} online</p>
      {canManageChannels && (
        <button type="button" className="create-channel-button" onClick={() => setCreateChannelOpen(true)}><Icon name="plus" size={16} /> Create channel</button>
      )}
      {createChannelOpen ? (
        <CreateChannelModal
          onCreated={(channel) => { onChannelCreated(channel); setCreateChannelOpen(false); }}
          onError={() => showToast("Could not create the channel")}
          onClose={() => setCreateChannelOpen(false)}
        />
      ) : null}
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
  voiceSpeakingUserIds,
  currentUserId,
  selectedChannelId,
  unreadChannelIds,
  unreadCounts,
  mentionChannelIds,
  onSelectChannel,
  onEditChannel,
  onViewProfile,
}: {
  title: string;
  channels: Channel[];
  voiceOccupancy: Record<string, VoiceParticipant[]>;
  voiceSpeakingUserIds?: string[];
  currentUserId: string;
  selectedChannelId: string | null;
  unreadChannelIds?: string[];
  unreadCounts?: Record<string, number>;
  mentionChannelIds?: string[];
  onSelectChannel(channelId: string): void;
  onEditChannel?(channelId: string): void;
  onViewProfile?(userId: string): void;
}) {
  if (channels.length === 0) return null;
  return (
    <section className="channel-group">
      <h2><Icon name="chevron" size={13} /> {title}</h2>
      <ul>
        {channels.map((channel) => {
          const occupants = voiceOccupancy[channel.id] ?? [];
          const unread = channel.type === "text" && (unreadChannelIds?.includes(channel.id) ?? false);
          const unreadCount = unreadCounts?.[channel.id] ?? 0;
          const mentioned = mentionChannelIds?.includes(channel.id) ?? false;
          return <li key={channel.id}>
            <div className="channel-row">
              <button
                type="button"
                className={`${channel.id === selectedChannelId ? "channel-link active" : "channel-link"} ${unread ? "has-unread" : ""}`}
                aria-label={unread ? `${channel.name}, unread messages` : channel.name}
                onClick={() => onSelectChannel(channel.id)}
              >
                <span className="channel-icon" aria-hidden="true"><Icon name={channel.type === "voice" ? "volume" : "hash"} /></span>
                <span className="channel-name">{channel.name}</span>
                {unread ? <><span className="channel-unread-dot" aria-hidden="true" /><span className={`channel-unread-badge ${mentioned ? "is-mention" : ""}`} aria-label={`${unreadCount} unread messages`}>{unreadCount > 99 ? "99+" : unreadCount}</span></> : null}
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
                {occupants.map((participant) => {
                  const speaking = voiceSpeakingUserIds?.includes(participant.userId) ?? false;
                  return (
                    <li key={participant.userId} className={speaking ? "is-speaking" : ""} onClick={() => onViewProfile?.(participant.userId)}>
                      <span className="member-avatar">{participant.avatarUrl ? <img src={participant.avatarUrl} alt="" /> : participant.username.slice(0, 1).toUpperCase()}</span>
                      <span className="voice-occupant-name">{participant.userId === currentUserId ? `${participant.username} (you)` : participant.username}</span>
                      <span className="voice-media-status" aria-label={`${participant.username}: ${participant.microphoneMuted ? "microphone muted" : "microphone on"}${participant.deafened ? ", sound muted" : ""}`}>
                        {participant.microphoneMuted ? <Icon name="microphoneOff" size={14} /> : null}
                        {participant.deafened ? <Icon name="headphonesOff" size={14} /> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>;
        })}
      </ul>
    </section>
  );
}

function CreateChannelModal({
  onCreated,
  onError,
  onClose,
}: {
  onCreated(channel: Channel): void;
  onError(): void;
  onClose(): void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Channel["type"]>("text");
  const [requiredCapability, setRequiredCapability] = useState<Capability | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const channel = await api.createChannel({ name: trimmed, type, requiredCapability });
      onCreated(channel);
    } catch {
      onError();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="voice-modal-backdrop create-channel-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onClose();
    }}>
      <section className="voice-settings-modal create-channel-modal" role="dialog" aria-modal="true" aria-labelledby="create-channel-title">
        <header><div><span>NEW CHANNEL</span><h2 id="create-channel-title">Create a channel</h2></div><button type="button" className="modal-close" aria-label="Close channel creation" onClick={onClose}><Icon name="close" size={18} /></button></header>
        <form className="create-channel-form" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Channel type</legend>
            <div className="channel-type-options">
              <button type="button" className={type === "text" ? "active" : ""} aria-pressed={type === "text"} onClick={() => setType("text")}><Icon name="hash" size={22} /><span><strong>Text</strong><small>Send messages, images and files</small></span></button>
              <button type="button" className={type === "voice" ? "active" : ""} aria-pressed={type === "voice"} onClick={() => setType("voice")}><Icon name="volume" size={22} /><span><strong>Voice</strong><small>Talk, use cameras and share screens</small></span></button>
            </div>
          </fieldset>
          <label>Channel name<div className="channel-name-field"><span aria-hidden="true">{type === "text" ? "#" : "◖))"}</span><input aria-label="New channel name" placeholder={type === "text" ? "new-channel" : "Voice lounge"} value={name} maxLength={64} autoFocus onChange={(event) => setName(event.target.value)} /></div></label>
          <label>Who can access it?<select aria-label="New channel access" value={requiredCapability ?? ""} onChange={(event) => setRequiredCapability((event.target.value || null) as Capability | null)}><option value="">Everyone</option>{(Object.keys(CAPABILITY_LABEL) as Capability[]).map((capability) => <option key={capability} value={capability}>{CAPABILITY_LABEL[capability]}</option>)}</select></label>
          <p className="create-channel-summary"><Icon name={type === "text" ? "hash" : "volume"} size={16} /> <span><strong>{name.trim() || (type === "text" ? "new-channel" : "Voice lounge")}</strong><small>{requiredCapability ? CAPABILITY_LABEL[requiredCapability] : "Visible to everyone"}</small></span></p>
          <footer><button type="button" className="profile-cancel" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" disabled={submitting || !name.trim()}>{submitting ? "Creating…" : "Create channel"}</button></footer>
        </form>
      </section>
    </div>
  );
}
