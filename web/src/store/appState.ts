import type { Channel, CurrentUser, Message } from "../api/client";
import type { ConnectionStatus } from "../ws/socketClient";
import type { VoiceParticipant } from "../ws/protocol";

export type AppState = {
  currentUser: CurrentUser | null;
  channels: Channel[];
  selectedChannelId: string | null;
  messagesByChannel: Record<string, Message[]>;
  unreadChannelIds: string[];
  onlineUserIds: string[];
  voiceOccupancy: Record<string, VoiceParticipant[]>;
  voiceSpeakingUserIds: string[];
  connectionStatus: ConnectionStatus;
};

export const initialAppState: AppState = {
  currentUser: null,
  channels: [],
  selectedChannelId: null,
  messagesByChannel: {},
  unreadChannelIds: [],
  onlineUserIds: [],
  voiceOccupancy: {},
  voiceSpeakingUserIds: [],
  connectionStatus: "connecting",
};

export type AppAction =
  | { type: "channels/set"; channels: Channel[] }
  | { type: "channel/added"; channel: Channel }
  | { type: "channel/updated"; channel: Channel }
  | { type: "channel/removed"; channelId: string }
  | { type: "channel/selected"; channelId: string }
  | { type: "messages/loaded"; channelId: string; messages: Message[] }
  | { type: "messages/prepended"; channelId: string; messages: Message[] }
  | { type: "message/received"; message: Message }
  | { type: "presence/sync"; userIds: string[] }
  | { type: "presence/online"; userId: string }
  | { type: "presence/offline"; userId: string }
  | { type: "voice/sync"; channels: Record<string, VoiceParticipant[]>; preserveChannelId?: string | null }
  | { type: "voice/channel-synced"; channelId: string; participants: VoiceParticipant[] }
  | { type: "voice/joined"; channelId: string; participant: VoiceParticipant }
  | { type: "voice/left"; channelId: string; userId: string }
  | { type: "voice/speaking"; userIds: string[] }
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
    case "channel/updated":
      return { ...state, channels: state.channels.map((channel) => channel.id === action.channel.id ? action.channel : channel) };
    case "channel/removed": {
      const channels = state.channels.filter((c) => c.id !== action.channelId);
      const selectedChannelId =
        state.selectedChannelId === action.channelId
          ? (channels[0]?.id ?? null)
          : state.selectedChannelId;
      return { ...state, channels, selectedChannelId, unreadChannelIds: state.unreadChannelIds.filter((id) => id !== action.channelId) };
    }
    case "channel/selected":
      return {
        ...state,
        selectedChannelId: action.channelId,
        unreadChannelIds: state.unreadChannelIds.filter((id) => id !== action.channelId),
      };
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
      const shouldMarkUnread = action.message.userId !== state.currentUser?.id && channelId !== state.selectedChannelId;
      return {
        ...state,
        messagesByChannel: { ...state.messagesByChannel, [channelId]: [...existing, action.message] },
        unreadChannelIds: shouldMarkUnread && !state.unreadChannelIds.includes(channelId)
          ? [...state.unreadChannelIds, channelId]
          : state.unreadChannelIds,
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
    case "voice/sync": {
      const voiceOccupancy = { ...action.channels };
      if (action.preserveChannelId && state.voiceOccupancy[action.preserveChannelId]) {
        voiceOccupancy[action.preserveChannelId] = state.voiceOccupancy[action.preserveChannelId];
      }
      return { ...state, voiceOccupancy };
    }
    case "voice/channel-synced": {
      const voiceOccupancy = { ...state.voiceOccupancy };
      if (action.participants.length === 0) delete voiceOccupancy[action.channelId];
      else voiceOccupancy[action.channelId] = action.participants;
      return { ...state, voiceOccupancy };
    }
    case "voice/joined": {
      const occupants = state.voiceOccupancy[action.channelId] ?? [];
      if (occupants.some((participant) => participant.userId === action.participant.userId)) return state;
      return {
        ...state,
        voiceOccupancy: {
          ...state.voiceOccupancy,
          [action.channelId]: [...occupants, action.participant],
        },
      };
    }
    case "voice/left": {
      const occupants = (state.voiceOccupancy[action.channelId] ?? []).filter(
        (participant) => participant.userId !== action.userId,
      );
      const voiceOccupancy = { ...state.voiceOccupancy };
      if (occupants.length === 0) delete voiceOccupancy[action.channelId];
      else voiceOccupancy[action.channelId] = occupants;
      return { ...state, voiceOccupancy };
    }
    case "voice/speaking":
      return { ...state, voiceSpeakingUserIds: action.userIds };
    case "connection/status":
      return { ...state, connectionStatus: action.status };
    default:
      return state;
  }
}
