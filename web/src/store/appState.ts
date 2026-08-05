import type { Channel, CurrentUser, Message } from "../api/client";
import type { ConnectionStatus } from "../ws/socketClient";

export type AppState = {
  currentUser: CurrentUser | null;
  channels: Channel[];
  selectedChannelId: string | null;
  messagesByChannel: Record<string, Message[]>;
  onlineUserIds: string[];
  connectionStatus: ConnectionStatus;
};

export const initialAppState: AppState = {
  currentUser: null,
  channels: [],
  selectedChannelId: null,
  messagesByChannel: {},
  onlineUserIds: [],
  connectionStatus: "connecting",
};

export type AppAction =
  | { type: "channels/set"; channels: Channel[] }
  | { type: "channel/added"; channel: Channel }
  | { type: "channel/removed"; channelId: string }
  | { type: "channel/selected"; channelId: string }
  | { type: "messages/loaded"; channelId: string; messages: Message[] }
  | { type: "messages/prepended"; channelId: string; messages: Message[] }
  | { type: "message/received"; message: Message }
  | { type: "presence/sync"; userIds: string[] }
  | { type: "presence/online"; userId: string }
  | { type: "presence/offline"; userId: string }
  | { type: "connection/status"; status: ConnectionStatus };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "channels/set": {
      const stillPresent = state.selectedChannelId && action.channels.some((c) => c.id === state.selectedChannelId);
      const selectedChannelId = stillPresent ? state.selectedChannelId : (action.channels[0]?.id ?? null);
      return { ...state, channels: action.channels, selectedChannelId };
    }
    case "channel/added":
      return state.channels.some((c) => c.id === action.channel.id)
        ? state
        : { ...state, channels: [...state.channels, action.channel] };
    case "channel/removed": {
      const channels = state.channels.filter((c) => c.id !== action.channelId);
      const selectedChannelId =
        state.selectedChannelId === action.channelId
          ? (channels[0]?.id ?? null)
          : state.selectedChannelId;
      return { ...state, channels, selectedChannelId };
    }
    case "channel/selected":
      return { ...state, selectedChannelId: action.channelId };
    case "messages/loaded":
      return {
        ...state,
        messagesByChannel: { ...state.messagesByChannel, [action.channelId]: action.messages },
      };
    case "messages/prepended": {
      const existing = state.messagesByChannel[action.channelId] ?? [];
      return {
        ...state,
        messagesByChannel: { ...state.messagesByChannel, [action.channelId]: [...action.messages, ...existing] },
      };
    }
    case "message/received": {
      const { channelId } = action.message;
      const existing = state.messagesByChannel[channelId] ?? [];
      return {
        ...state,
        messagesByChannel: { ...state.messagesByChannel, [channelId]: [...existing, action.message] },
      };
    }
    case "presence/sync":
      return { ...state, onlineUserIds: action.userIds };
    case "presence/online":
      return state.onlineUserIds.includes(action.userId)
        ? state
        : { ...state, onlineUserIds: [...state.onlineUserIds, action.userId] };
    case "presence/offline":
      return { ...state, onlineUserIds: state.onlineUserIds.filter((id) => id !== action.userId) };
    case "connection/status":
      return { ...state, connectionStatus: action.status };
    default:
      return state;
  }
}
