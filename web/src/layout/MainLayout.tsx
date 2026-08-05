import { useCallback, useEffect, useReducer } from "react";
import type { CurrentUser } from "../api/client";
import * as api from "../api/client";
import { appReducer, initialAppState } from "../store/appState";
import { createSocketClient } from "../ws/socketClient";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../toast/ToastContext";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { UserBar } from "./UserBar";
import { ConnectionBanner } from "./ConnectionBanner";

export function MainLayout({ currentUser }: { currentUser: CurrentUser }) {
  const { signOut } = useAuth();
  const { showToast } = useToast();
  const [state, dispatch] = useReducer(appReducer, { ...initialAppState, currentUser });

  useEffect(() => {
    api
      .listChannels()
      .then((channels) => dispatch({ type: "channels/set", channels }))
      .catch(() => showToast("Impossible de charger les channels"));
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

  return (
    <div className="app-shell">
      {state.connectionStatus !== "open" && <ConnectionBanner status={state.connectionStatus} />}
      <div className="main-layout">
        <aside className="sidebar-column">
          <Sidebar
            channels={state.channels}
            selectedChannelId={state.selectedChannelId}
            onlineUserIds={state.onlineUserIds}
            currentUser={currentUser}
            onSelectChannel={selectChannel}
            onChannelCreated={(channel) => dispatch({ type: "channel/added", channel })}
          />
          <UserBar currentUser={currentUser} onSignOut={signOut} />
        </aside>
        <div className="main-content">
          {selectedChannel ? (
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
          ) : (
            <div className="no-channel">Aucun channel</div>
          )}
        </div>
      </div>
    </div>
  );
}
