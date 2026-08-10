import { lazy, Suspense, useCallback, useEffect, useReducer, useState } from "react";
import type { Channel, CurrentUser } from "../api/client";
import * as api from "../api/client";
import { appReducer, initialAppState } from "../store/appState";
import { createSocketClient } from "../ws/socketClient";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../toast/ToastContext";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { UserBar } from "./UserBar";
import { ConnectionBanner } from "./ConnectionBanner";

const VoiceView = lazy(() => import("../voice/VoiceView").then((module) => ({ default: module.VoiceView })));

export function MainLayout({ currentUser }: { currentUser: CurrentUser }) {
  const { signOut } = useAuth();
  const { showToast } = useToast();
  const [state, dispatch] = useReducer(appReducer, { ...initialAppState, currentUser });
  const [retainedVoiceChannel, setRetainedVoiceChannel] = useState<Channel | null>(null);

  useEffect(() => {
    api
      .listChannels()
      .then((channels) => dispatch({ type: "channels/set", channels }))
      .catch(() => showToast("Could not load channels"));
  }, [showToast]);

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
            break;
          case "channel.created":
            dispatch({ type: "channel/added", channel: event.channel });
            break;
          case "channel.deleted":
            dispatch({ type: "channel/removed", channelId: event.channelId });
            break;
          case "voice.sync":
            dispatch({ type: "voice/sync", channels: event.channels });
            break;
          case "voice.joined":
            dispatch({ type: "voice/joined", channelId: event.channelId, participant: event.participant });
            break;
          case "voice.left":
            dispatch({ type: "voice/left", channelId: event.channelId, userId: event.userId });
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
        <aside className="sidebar-column">
          <Sidebar
            channels={state.channels}
            selectedChannelId={state.selectedChannelId}
            onlineUserIds={state.onlineUserIds}
            voiceOccupancy={state.voiceOccupancy}
            currentUser={currentUser}
            onSelectChannel={selectChannel}
            onChannelCreated={(channel) => dispatch({ type: "channel/added", channel })}
            onChannelUpdated={(channel) => dispatch({ type: "channel/updated", channel })}
            onChannelDeleted={(channelId) => dispatch({ type: "channel/removed", channelId })}
          />
          <UserBar currentUser={currentUser} onSignOut={signOut} />
        </aside>
        <div className="main-content">
          {selectedChannel?.type === "text" ? (
            <ChatView
              channel={selectedChannel}
              messages={state.messagesByChannel[selectedChannel.id] ?? []}
              onMessagesLoaded={(messages) =>
                dispatch({ type: "messages/loaded", channelId: selectedChannel.id, messages })
              }
              onMessagesPrepended={(messages) =>
                dispatch({ type: "messages/prepended", channelId: selectedChannel.id, messages })
              }
            />
          ) : selectedChannel?.type !== "voice" ? (
            <div className="no-channel">No channel</div>
          ) : null}
          {voiceChannel ? (
            <Suspense fallback={<div className="no-channel">Loading voice…</div>}>
              <VoiceView
                channel={voiceChannel}
                currentUser={currentUser}
                visible={selectedChannel?.type === "voice"}
              />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
}
