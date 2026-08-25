import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Capability, Channel, Conversation, CurrentUser, VersionInfo } from "../api/client";
import * as api from "../api/client";
import { useToast } from "../toast/ToastContext";
import type { PresenceUser, VoiceParticipant } from "../ws/protocol";
import { Icon } from "../ui/Icon";
import { RadioGroup, Select, TextField } from "../ui/form";
import { Wordmark } from "../ui/Wordmark";
import { AdminPanel } from "./AdminPanel";
import { ChannelSettingsModal } from "./ChannelSettingsModal";
import { VersionBadge } from "./VersionBadge";

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
  onlineUsers,
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
  version,
  onOpenAbout,
  conversations,
  selectedConversationId,
  unreadConversationIds,
  unreadConversationCounts,
  onSelectConversation,
  onConversationCreated,
  onConversationUpdated,
  onConversationRemoved,
}: {
  channels: Channel[];
  selectedChannelId: string | null;
  onlineUserIds: string[];
  onlineUsers?: PresenceUser[];
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
  version?: VersionInfo | null;
  onOpenAbout?(): void;
  conversations?: Conversation[];
  selectedConversationId?: string | null;
  unreadConversationIds?: string[];
  unreadConversationCounts?: Record<string, number>;
  onSelectConversation?(conversationId: string): void;
  onConversationCreated?(conversation: Conversation): void;
  onConversationUpdated?(conversation: Conversation): void;
  onConversationRemoved?(conversationId: string): void;
}) {
  const { showToast } = useToast();
  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");
  const [adminOpen, setAdminOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const editingChannel = channels.find((c) => c.id === editingChannelId) ?? null;
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const editingConversation = (conversations ?? []).find((c) => c.id === editingConversationId) ?? null;
  const canManageChannels = currentUser.capabilities.includes("manage_channels");
  const canManageServer = currentUser.capabilities.includes("manage_server");
  const canModerate = currentUser.capabilities.includes("moderate");

  return (
    <nav className="sidebar" aria-label="Channels">
      <div className="sidebar-server-name">
          <Wordmark />
        <div className="sidebar-server-actions">
          <VersionBadge version={version ?? null} onClick={() => onOpenAbout?.()} />
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
      <section className="channel-group conversation-group">
        <h2><Icon name="chevron" size={13} /> Direct messages</h2>
        <ul>
          {(conversations ?? []).map((conversation) => {
            const name = conversationDisplayName(conversation, currentUser.id);
            const unread = unreadConversationIds?.includes(conversation.id) ?? false;
            const unreadCount = unreadConversationCounts?.[conversation.id] ?? 0;
            return <li key={conversation.id}>
              <div className="channel-row">
                <button
                  type="button"
                  className={`${conversation.id === selectedConversationId ? "channel-link active" : "channel-link"} ${unread ? "has-unread" : ""}`}
                  aria-label={unread ? `${name}, unread messages` : name}
                  onClick={() => onSelectConversation?.(conversation.id)}
                >
                  <span className="channel-icon" aria-hidden="true"><Icon name={conversation.type === "group" ? "users" : "message"} /></span>
                  <span className="channel-name">{name}</span>
                  {unread ? <><span className="channel-unread-dot" aria-hidden="true" /><span className="channel-unread-badge" aria-label={`${unreadCount} unread messages`}>{unreadCount > 99 ? "99+" : unreadCount}</span></> : null}
                </button>
                {conversation.type === "group" ? (
                  <button
                    type="button"
                    className="channel-settings-button"
                    aria-label={`Settings for ${name}`}
                    title={`Settings for ${name}`}
                    onClick={() => setEditingConversationId(conversation.id)}
                  >
                    <Icon name="settings" size={14} />
                  </button>
                ) : null}
              </div>
            </li>;
          })}
        </ul>
        <button type="button" className="create-channel-button" onClick={() => setNewConversationOpen(true)}><Icon name="plus" size={16} /> New message</button>
      </section>
      <p className="sidebar-presence"><span className="online-dot" /> {onlineUserIds.length} online</p>
      <section className="online-members" aria-label="Online members">
        <h2><span className="online-dot" /> Online — {onlineUserIds.length}</h2>
        <ul>
          {(onlineUsers ?? []).map((user) => <li key={user.id}><span className="online-member-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.username.slice(0, 1).toUpperCase()}</span><span>{user.username}</span></li>)}
          {(onlineUsers ?? []).length === 0 && <li className="online-members-empty">No names available yet</li>}
        </ul>
      </section>
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
      {newConversationOpen ? (
        <NewConversationModal
          currentUserId={currentUser.id}
          onlineUsers={onlineUsers}
          onCreated={(conversation) => { onConversationCreated?.(conversation); setNewConversationOpen(false); }}
          onError={() => showToast("Could not start the conversation")}
          onClose={() => setNewConversationOpen(false)}
        />
      ) : null}
      {editingConversation ? (
        <GroupSettingsModal
          conversation={editingConversation}
          currentUserId={currentUser.id}
          onUpdated={(conversation) => onConversationUpdated?.(conversation)}
          onLeft={() => { onConversationRemoved?.(editingConversation.id); setEditingConversationId(null); }}
          onError={() => showToast("Could not update the group")}
          onClose={() => setEditingConversationId(null)}
        />
      ) : null}
    </nav>
  );
}

// Groups get their own name; a 1:1 DM is labeled with the other participant.
export function conversationDisplayName(conversation: Conversation, currentUserId: string): string {
  if (conversation.type === "group" && conversation.name) return conversation.name;
  const others = conversation.participants.filter((p) => p.userId !== currentUserId);
  if (others.length === 0) return conversation.type === "group" ? "Empty group" : "Direct message";
  return others.map((p) => p.username).join(", ");
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
          <RadioGroup<Channel["type"]>
            label="Channel type"
            value={type}
            onChange={setType}
            options={[
              { value: "text" as const, label: "Text", description: "Send messages, images and files", icon: <Icon name="hash" size={22} /> },
              { value: "voice" as const, label: "Voice", description: "Talk, use cameras and share screens", icon: <Icon name="volume" size={22} /> },
            ]}
          />
          <TextField
            label="Channel name"
            placeholder={type === "text" ? "new-channel" : "Voice lounge"}
            value={name}
            maxLength={64}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            prefix={type === "text" ? "#" : "◖))"}
          />
          <Select
            label="Who can access it?"
            value={requiredCapability ?? ""}
            onChange={(event) => setRequiredCapability((event.target.value || null) as Capability | null)}
          >
            <option value="">Everyone</option>
            {(Object.keys(CAPABILITY_LABEL) as Capability[]).map((capability) => <option key={capability} value={capability}>{CAPABILITY_LABEL[capability]}</option>)}
          </Select>
          <p className="create-channel-summary"><Icon name={type === "text" ? "hash" : "volume"} size={16} /> <span><strong>{name.trim() || (type === "text" ? "new-channel" : "Voice lounge")}</strong><small>{requiredCapability ? CAPABILITY_LABEL[requiredCapability] : "Visible to everyone"}</small></span></p>
          <footer><button type="button" className="profile-cancel" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" disabled={submitting || !name.trim()}>{submitting ? "Creating…" : "Create channel"}</button></footer>
        </form>
      </section>
    </div>
  );
}

type MemberOption = { id: string; username: string; avatarUrl: string | null };

// Debounced member search shared by the new-conversation and group-settings
// modals -- both need "type a name, pick from matches" over the full member
// list (not just online users), reusing /api/search the same way SearchModal does.
function useMemberSearch(excludeIds: string[], browseList: MemberOption[] = []) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberOption[]>([]);
  const requestRef = useRef(0);
  // Keyed on the ids rather than the array itself: excludeIds/browseList are
  // freshly-allocated on every parent render, and re-running this effect on
  // every render (not just when the actual membership changes) would refetch
  // needlessly and, with the browse-list branch, race the clear-on-select in
  // pickTopResult below.
  const excludeKey = excludeIds.join(",");
  const browseKey = browseList.map((m) => m.id).join(",");
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(browseList.filter((member) => !excludeIds.includes(member.id)));
      return;
    }
    const request = ++requestRef.current;
    const timer = setTimeout(() => {
      void api.search(query.trim())
        .then((value) => { if (request === requestRef.current) setResults(value.members.filter((member) => !excludeIds.includes(member.id))); })
        .catch(() => { if (request === requestRef.current) setResults([]); });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, excludeKey, browseKey]);
  return { query, setQuery, results, browsing: query.trim().length < 2 };
}

function NewConversationModal({
  currentUserId,
  onlineUsers,
  onCreated,
  onError,
  onClose,
}: {
  currentUserId: string;
  onlineUsers?: PresenceUser[];
  onCreated(conversation: Conversation): void;
  onError(): void;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<MemberOption[]>([]);
  const [groupName, setGroupName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const browseList = (onlineUsers ?? []).map((user) => ({ id: user.id, username: user.username, avatarUrl: user.avatarUrl ?? null }));
  const { query, setQuery, results, browsing } = useMemberSearch([currentUserId, ...selected.map((m) => m.id)], browseList);

  function pickTopResult() {
    if (results.length === 0) return;
    setSelected((values) => [...values, results[0]]);
    setQuery("");
  }

  async function handleSubmit() {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const conversation = selected.length === 1
        ? await api.createDirectMessage(selected[0].id)
        : await api.createGroupConversation(selected.map((m) => m.id), groupName.trim() || undefined);
      onCreated(conversation);
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
      <section className="voice-settings-modal create-channel-modal" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title">
        <header><div><span>NEW MESSAGE</span><h2 id="new-conversation-title">Start a conversation</h2></div><button type="button" className="modal-close" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></header>
        <form className="create-channel-form" onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
          {selected.length > 0 ? (
            <ul className="conversation-member-chips" aria-label="Selected members">
              {selected.map((member) => <li key={member.id}>{member.username}<button type="button" aria-label={`Remove ${member.username}`} onClick={() => setSelected((values) => values.filter((v) => v.id !== member.id))}><Icon name="close" size={12} /></button></li>)}
            </ul>
          ) : null}
          <TextField
            label="Search members"
            visuallyHiddenLabel
            autoFocus
            placeholder="Search by username"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && results.length > 0) { event.preventDefault(); pickTopResult(); } }}
          />
          {results.length > 0 ? (
            <ul className="conversation-member-results" aria-label={browsing ? "Online members" : "Search results"}>
              {browsing ? <li className="conversation-member-results-heading" aria-hidden="true">Online</li> : null}
              {results.map((member) => <li key={member.id}><button type="button" onClick={() => { setSelected((values) => [...values, member]); setQuery(""); }}><span className="member-avatar">{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.username[0].toUpperCase()}</span><span>{member.username}</span></button></li>)}
            </ul>
          ) : null}
          {selected.length > 1 ? (
            <TextField label="Group name (optional)" placeholder="New group" value={groupName} maxLength={64} onChange={(event) => setGroupName(event.target.value)} />
          ) : null}
          <footer><button type="button" className="profile-cancel" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" disabled={submitting || selected.length === 0}>{submitting ? "Starting…" : selected.length > 1 ? "Create group" : "Message"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function GroupSettingsModal({
  conversation,
  currentUserId,
  onUpdated,
  onLeft,
  onError,
  onClose,
}: {
  conversation: Conversation;
  currentUserId: string;
  onUpdated(conversation: Conversation): void;
  onLeft(): void;
  onError(): void;
  onClose(): void;
}) {
  const [name, setName] = useState(conversation.name ?? "");
  const [busy, setBusy] = useState(false);
  const { query, setQuery, results } = useMemberSearch(conversation.participants.map((p) => p.userId));

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === conversation.name || busy) return;
    setBusy(true);
    try { onUpdated(await api.renameConversation(conversation.id, trimmed)); }
    catch { onError(); }
    finally { setBusy(false); }
  }

  async function addParticipant(userId: string) {
    if (busy) return;
    setBusy(true);
    try { onUpdated(await api.addConversationParticipant(conversation.id, userId)); setQuery(""); }
    catch { onError(); }
    finally { setBusy(false); }
  }

  async function removeParticipant(userId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api.removeConversationParticipant(conversation.id, userId);
      if (userId === currentUserId) onLeft();
      else onUpdated({ ...conversation, participants: conversation.participants.filter((p) => p.userId !== userId) });
    } catch { onError(); }
    finally { setBusy(false); }
  }

  return (
    <div className="voice-modal-backdrop create-channel-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="voice-settings-modal create-channel-modal" role="dialog" aria-modal="true" aria-labelledby="group-settings-title">
        <header><div><span>GROUP</span><h2 id="group-settings-title">Group settings</h2></div><button type="button" className="modal-close" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></header>
        <div className="create-channel-form">
          <TextField label="Group name" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} onBlur={saveName} />
          <ul className="conversation-member-chips" aria-label="Members">
            {conversation.participants.map((member) => <li key={member.userId}>{member.username}{member.userId === currentUserId ? " (you)" : ""}<button type="button" aria-label={`Remove ${member.username}`} onClick={() => void removeParticipant(member.userId)}><Icon name="userMinus" size={12} /></button></li>)}
          </ul>
          <TextField label="Add a member" visuallyHiddenLabel placeholder="Search by username" value={query} onChange={(event) => setQuery(event.target.value)} />
          {results.length > 0 ? (
            <ul className="conversation-member-results" aria-label="Search results">
              {results.map((member) => <li key={member.id}><button type="button" onClick={() => void addParticipant(member.id)}><span className="member-avatar">{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.username[0].toUpperCase()}</span><span>{member.username}</span><Icon name="userPlus" size={14} /></button></li>)}
            </ul>
          ) : null}
          <footer><button type="button" className="danger-link" onClick={() => void removeParticipant(currentUserId)} disabled={busy}><Icon name="logout" size={14} /> Leave group</button></footer>
        </div>
      </section>
    </div>
  );
}
