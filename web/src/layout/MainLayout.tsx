import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Channel, ChatSettings, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { appReducer, initialAppState } from "../store/appState";
import { createSocketClient } from "../ws/socketClient";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../toast/ToastContext";
import { Sidebar, conversationDisplayName } from "./Sidebar";
import { ChatView } from "./ChatView";
import { UserBar } from "./UserBar";
import { ConnectionBanner } from "./ConnectionBanner";
import { configureSounds, playAppSound } from "../audio/sounds";
import { applyAuthenticatedAccent } from "../theme/accent";
import { Icon } from "../ui/Icon";
import { ProfileModal } from "./ProfileModal";
import { UserProfileModal } from "./UserProfileModal";
import { SearchModal } from "./SearchModal";
import { AboutModal } from "./AboutModal";

const VoiceView = lazy(() => import("../voice/VoiceView").then((module) => ({ default: module.VoiceView })));

export function MainLayout({ currentUser }: { currentUser: CurrentUser }) {
  const { signOut, refresh } = useAuth();
  const { showToast } = useToast();
  const [state, dispatch] = useReducer(appReducer, { ...initialAppState, currentUser });
  const [retainedVoiceChannel, setRetainedVoiceChannel] = useState<Channel | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [viewedProfileId, setViewedProfileId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [version, setVersion] = useState<api.VersionInfo | null>(null);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({ maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
  const [notificationLevels, setNotificationLevels] = useState<Record<string, "all" | "mentions" | "none">>(() => {
    try { return JSON.parse(localStorage.getItem("vocal.notification-levels") ?? "{}"); } catch { return {}; }
  });
  const notificationLevelsRef = useRef(notificationLevels);
  const joinedVoiceChannelIdRef = useRef<string | null>(null);
  const selfVoiceStatusRef = useRef({ microphoneMuted: true, deafened: false });
  const socketRef = useRef<ReturnType<typeof createSocketClient> | null>(null);
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [typingByChannel, setTypingByChannel] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileSidebarOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSidebarOpen]);

  useEffect(() => {
    api
      .listChannels()
      .then((channels) => dispatch({ type: "channels/set", channels }))
      .catch(() => showToast("Could not load channels"));
  }, [showToast]);

  useEffect(() => {
    api
      .listConversations()
      .then((conversations) => dispatch({ type: "conversations/set", conversations }))
      .catch(() => showToast("Could not load direct messages"));
  }, [showToast]);

  useEffect(() => { void api.getChatSettings().then(setChatSettings).catch(() => {}); }, []);
  useEffect(() => { void api.getVersion().then(setVersion).catch(() => {}); }, []);

  useEffect(() => {
    void Promise.all([api.getSoundSettings(), api.getMySoundVolumes(), api.getMySoundSettings()])
      .then(([soundSettings, soundVolumes, userSoundSettings]) => configureSounds(soundSettings, soundVolumes, userSoundSettings))
      .catch(() => {});
    void applyAuthenticatedAccent();
  }, []);

  useEffect(() => {
    const socket = createSocketClient(api.getWsUrl(), {
      onEvent(event) {
        switch (event.type) {
          case "presence.sync":
            dispatch({ type: "presence/sync", userIds: event.userIds, users: event.users });
            break;
          case "presence.online":
            dispatch({ type: "presence/online", userId: event.userId, user: event.user });
            break;
          case "presence.offline":
            dispatch({ type: "presence/offline", userId: event.userId });
            break;
          case "message.created": {
            const mentioned = event.message.content.includes("@everyone") || event.message.content.toLocaleLowerCase().includes(`@${currentUser.username.toLocaleLowerCase()}`);
            const targetId = event.message.channelId ?? event.message.conversationId!;
            const notificationLevel = notificationLevelsRef.current[targetId] ?? "all";
            dispatch({ type: "message/received", message: event.message, markUnread: notificationLevel === "all" || (notificationLevel === "mentions" && mentioned), mention: mentioned });
            if (event.message.userId !== currentUser.id) playAppSound("message");
            break;
          }
          case "message.updated":
            dispatch({ type: "message/updated", message: event.message });
            break;
          case "message.deleted":
            dispatch({ type: "message/deleted", channelId: event.channelId, conversationId: event.conversationId, messageId: event.messageId });
            break;
          case "typing.updated": {
            if (event.userId === currentUser.id) break;
            const targetId = event.channelId ?? event.conversationId!;
            const key = `${targetId}:${event.userId}`;
            const previous = typingTimersRef.current.get(key);
            if (previous) clearTimeout(previous);
            setTypingByChannel((value) => {
              const channel = { ...(value[targetId] ?? {}) };
              if (event.active) channel[event.userId] = event.username;
              else delete channel[event.userId];
              return { ...value, [targetId]: channel };
            });
            if (event.active) typingTimersRef.current.set(key, setTimeout(() => setTypingByChannel((value) => {
              const channel = { ...(value[targetId] ?? {}) }; delete channel[event.userId]; return { ...value, [targetId]: channel };
            }), 3500));
            break;
          }
          case "channel.created":
            dispatch({ type: "channel/added", channel: event.channel });
            break;
          case "channel.deleted":
            dispatch({ type: "channel/removed", channelId: event.channelId });
            break;
          case "conversation.created":
            dispatch({ type: "conversation/added", conversation: event.conversation });
            break;
          case "conversation.updated":
            dispatch({ type: "conversation/updated", conversation: event.conversation });
            break;
          case "conversation.removed":
            dispatch({ type: "conversation/removed", conversationId: event.conversationId });
            break;
          case "voice.sync":
            dispatch({ type: "voice/sync", channels: event.channels, preserveChannelId: joinedVoiceChannelIdRef.current });
            joinedVoiceChannelIdRef.current = Object.entries(event.channels)
              .find(([, participants]) => participants.some((participant) => participant.userId === currentUser.id))?.[0] ?? null;
            break;
          case "voice.joined":
            dispatch({ type: "voice/joined", channelId: event.channelId, participant: event.participant });
            if (event.participant.userId === currentUser.id) {
              joinedVoiceChannelIdRef.current = event.channelId;
              socketRef.current?.send({ type: "voice.status", channelId: event.channelId, ...selfVoiceStatusRef.current });
              playAppSound("userJoin");
            } else if (joinedVoiceChannelIdRef.current === event.channelId) {
              playAppSound("userJoin");
            }
            break;
          case "voice.updated":
            dispatch({ type: "voice/updated", channelId: event.channelId, participant: event.participant });
            break;
          case "voice.left":
            dispatch({ type: "voice/left", channelId: event.channelId, userId: event.userId });
            if (joinedVoiceChannelIdRef.current === event.channelId) playAppSound("userLeave");
            if (event.userId === currentUser.id) joinedVoiceChannelIdRef.current = null;
            break;
        }
      },
      onStatusChange(status) {
        dispatch({ type: "connection/status", status });
      },
    });
    socketRef.current = socket;
    return () => { socketRef.current = null; socket.close(); for (const timer of typingTimersRef.current.values()) clearTimeout(timer); };
  }, []);

  const selectChannel = useCallback((channelId: string) => {
    dispatch({ type: "channel/selected", channelId });
    setMobileSidebarOpen(false);
  }, []);

  const selectConversation = useCallback((conversationId: string) => {
    dispatch({ type: "conversation/selected", conversationId });
    setMobileSidebarOpen(false);
  }, []);

  const reportSelfVoiceStatus = useCallback((channelId: string, status: { microphoneMuted: boolean; deafened: boolean }) => {
    selfVoiceStatusRef.current = status;
    socketRef.current?.send({ type: "voice.status", channelId, ...status });
  }, []);

  const selectedChannel = state.channels.find((c) => c.id === state.selectedChannelId) ?? null;
  const voiceChannel = selectedChannel?.type === "voice" ? selectedChannel : retainedVoiceChannel;
  const selectedConversation = state.conversations.find((c) => c.id === state.selectedConversationId) ?? null;
  const conversationAsChannel = selectedConversation ? {
    id: selectedConversation.id,
    name: conversationDisplayName(selectedConversation, currentUser.id),
    type: "text" as const,
    requiredCapability: null,
    position: 0,
    createdAt: selectedConversation.createdAt,
  } : null;

  useEffect(() => {
    if (selectedChannel?.type === "voice") setRetainedVoiceChannel(selectedChannel);
  }, [selectedChannel]);

  return (
    <div className="app-shell">
      {state.connectionStatus !== "open" && <ConnectionBanner status={state.connectionStatus} />}
      <div className="main-layout">
        {mobileSidebarOpen && (
          <div className="sidebar-backdrop" role="presentation" onClick={() => setMobileSidebarOpen(false)} />
        )}
        <aside className={`sidebar-column ${mobileSidebarOpen ? "is-open" : ""}`}>
          <Sidebar
            channels={state.channels}
            selectedChannelId={state.selectedChannelId}
            onlineUserIds={state.onlineUserIds}
            onlineUsers={state.onlineUsers}
            voiceOccupancy={state.voiceOccupancy}
            voiceSpeakingUserIds={state.voiceSpeakingUserIds}
            unreadChannelIds={state.unreadChannelIds}
            unreadCounts={state.unreadCounts}
            mentionChannelIds={state.mentionChannelIds}
            onViewProfile={setViewedProfileId}
            onOpenSearch={() => setSearchOpen(true)}
            version={version}
            onOpenAbout={() => setAboutOpen(true)}
            currentUser={currentUser}
            onSelectChannel={selectChannel}
            onChannelCreated={(channel) => dispatch({ type: "channel/added", channel })}
            onChannelUpdated={(channel) => dispatch({ type: "channel/updated", channel })}
            onChannelDeleted={(channelId) => dispatch({ type: "channel/removed", channelId })}
            conversations={state.conversations}
            selectedConversationId={state.selectedConversationId}
            unreadConversationIds={state.unreadConversationIds}
            unreadConversationCounts={state.unreadConversationCounts}
            onSelectConversation={selectConversation}
            onConversationCreated={(conversation) => { dispatch({ type: "conversation/added", conversation }); selectConversation(conversation.id); }}
            onConversationUpdated={(conversation) => dispatch({ type: "conversation/updated", conversation })}
            onConversationRemoved={(conversationId) => dispatch({ type: "conversation/removed", conversationId })}
          />
          <UserBar currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onSignOut={signOut} />
        </aside>
        <div className="main-content">
          {selectedChannel?.type === "text" ? (
            <ChatView
              key={selectedChannel.id}
              channel={selectedChannel}
              maxMessageLength={chatSettings.maxMessageLength}
              messages={state.messagesByChannel[selectedChannel.id] ?? []}
              onMessagesLoaded={(messages) =>
                dispatch({ type: "messages/loaded", channelId: selectedChannel.id, messages })
              }
              onMessagesPrepended={(messages) =>
                dispatch({ type: "messages/prepended", channelId: selectedChannel.id, messages })
              }
              onOpenSidebar={() => setMobileSidebarOpen(true)}
              onViewProfile={setViewedProfileId}
              currentUser={currentUser}
              typingUsernames={Object.values(typingByChannel[selectedChannel.id] ?? {})}
              onTypingChange={(active) => socketRef.current?.send({ type: "typing.update", channelId: selectedChannel.id, active })}
              notificationLevel={notificationLevels[selectedChannel.id] ?? "all"}
              onNotificationLevelChange={(level) => setNotificationLevels((value) => {
                const next = { ...value, [selectedChannel.id]: level }; notificationLevelsRef.current = next; localStorage.setItem("vocal.notification-levels", JSON.stringify(next)); return next;
              })}
            />
          ) : conversationAsChannel ? (
            <ChatView
              key={conversationAsChannel.id}
              channel={conversationAsChannel}
              isConversation
              maxMessageLength={chatSettings.maxMessageLength}
              messages={state.messagesByConversation[conversationAsChannel.id] ?? []}
              onMessagesLoaded={(messages) =>
                dispatch({ type: "conversation-messages/loaded", conversationId: conversationAsChannel.id, messages })
              }
              onMessagesPrepended={(messages) =>
                dispatch({ type: "conversation-messages/prepended", conversationId: conversationAsChannel.id, messages })
              }
              onOpenSidebar={() => setMobileSidebarOpen(true)}
              onViewProfile={setViewedProfileId}
              currentUser={currentUser}
              typingUsernames={Object.values(typingByChannel[conversationAsChannel.id] ?? {})}
              onTypingChange={(active) => socketRef.current?.send({ type: "typing.update", conversationId: conversationAsChannel.id, active })}
            />
          ) : selectedChannel?.type !== "voice" ? (
            <div className="no-channel">
              <button type="button" className="mobile-menu-button" aria-label="Open channel list" onClick={() => setMobileSidebarOpen(true)}>
                <Icon name="menu" size={20} />
              </button>
              No channel
            </div>
          ) : null}
          {voiceChannel ? (
            <Suspense fallback={<div className="no-channel">Loading voice…</div>}>
              <VoiceView
                channel={voiceChannel}
                currentUser={currentUser}
                visible={selectedChannel?.type === "voice"}
                onOpenSidebar={() => setMobileSidebarOpen(true)}
                onSpeakingChange={(userIds) => dispatch({ type: "voice/speaking", userIds })}
                onParticipantsChange={(participants) => dispatch({
                  type: "voice/channel-synced",
                  channelId: voiceChannel.id,
                  participants,
                })}
                onSelfMediaStatusChange={reportSelfVoiceStatus}
                onSelfPresenceChange={(present) => {
                  if (present) {
                    joinedVoiceChannelIdRef.current = voiceChannel.id;
                    dispatch({
                      type: "voice/joined",
                      channelId: voiceChannel.id,
                      participant: { userId: currentUser.id, username: currentUser.username },
                    });
                  } else {
                    if (joinedVoiceChannelIdRef.current === voiceChannel.id) joinedVoiceChannelIdRef.current = null;
                    dispatch({ type: "voice/left", channelId: voiceChannel.id, userId: currentUser.id });
                  }
                }}
              />
            </Suspense>
          ) : null}
        </div>
        {profileOpen ? <ProfileModal currentUser={currentUser} onClose={() => setProfileOpen(false)} onSaved={refresh} /> : null}
        {viewedProfileId ? <UserProfileModal userId={viewedProfileId} onClose={() => setViewedProfileId(null)} /> : null}
        {searchOpen ? <SearchModal onClose={() => setSearchOpen(false)} onSelectChannel={selectChannel} onViewProfile={setViewedProfileId} /> : null}
        {aboutOpen && version ? <AboutModal version={version} onClose={() => setAboutOpen(false)} /> : null}
      </div>
    </div>
  );
}
