import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Channel, ChatSettings, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { appReducer, initialAppState } from "../store/appState";
import { createSocketClient } from "../ws/socketClient";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../toast/ToastContext";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { UserBar } from "./UserBar";
import { ConnectionBanner } from "./ConnectionBanner";
import { playAppSound } from "../audio/sounds";
import { Icon } from "../ui/Icon";
import { ProfileModal } from "./ProfileModal";

const VoiceView = lazy(() => import("../voice/VoiceView").then((module) => ({ default: module.VoiceView })));

export function MainLayout({ currentUser }: { currentUser: CurrentUser }) {
  const { signOut, refresh } = useAuth();
  const { showToast } = useToast();
  const [state, dispatch] = useReducer(appReducer, { ...initialAppState, currentUser });
  const [retainedVoiceChannel, setRetainedVoiceChannel] = useState<Channel | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({ maxImageSizeMb: 5, maxFileSizeMb: 10, maxMessageLength: 4000 });
  const joinedVoiceChannelIdRef = useRef<string | null>(null);

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

  useEffect(() => { void api.getChatSettings().then(setChatSettings).catch(() => {}); }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = createSocketClient(`${protocol}//${window.location.host}/ws`, {
      onEvent(event) {
        switch (event.type) {
          case "presence.sync":
            dispatch({ type: "presence/sync", userIds: event.userIds });
            break;
          case "presence.online":
            dispatch({ type: "presence/online", userId: event.userId });
            break;
          case "presence.offline":
            dispatch({ type: "presence/offline", userId: event.userId });
            break;
          case "message.created":
            dispatch({ type: "message/received", message: event.message });
            if (event.message.userId !== currentUser.id) playAppSound("message");
            break;
          case "channel.created":
            dispatch({ type: "channel/added", channel: event.channel });
            break;
          case "channel.deleted":
            dispatch({ type: "channel/removed", channelId: event.channelId });
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
              playAppSound("userJoin");
            } else if (joinedVoiceChannelIdRef.current === event.channelId) {
              playAppSound("userJoin");
            }
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
    return () => socket.close();
  }, []);

  const selectChannel = useCallback((channelId: string) => {
    dispatch({ type: "channel/selected", channelId });
    setMobileSidebarOpen(false);
  }, []);

  const selectedChannel = state.channels.find((c) => c.id === state.selectedChannelId) ?? null;
  const voiceChannel = selectedChannel?.type === "voice" ? selectedChannel : retainedVoiceChannel;

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
            voiceOccupancy={state.voiceOccupancy}
            voiceSpeakingUserIds={state.voiceSpeakingUserIds}
            unreadChannelIds={state.unreadChannelIds}
            currentUser={currentUser}
            onSelectChannel={selectChannel}
            onChannelCreated={(channel) => dispatch({ type: "channel/added", channel })}
            onChannelUpdated={(channel) => dispatch({ type: "channel/updated", channel })}
            onChannelDeleted={(channelId) => dispatch({ type: "channel/removed", channelId })}
          />
          <UserBar currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onSignOut={signOut} />
        </aside>
        <div className="main-content">
          {selectedChannel?.type === "text" ? (
            <ChatView
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
      </div>
    </div>
  );
}
