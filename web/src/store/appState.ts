import type { Channel, Conversation, CurrentUser, Message } from "../api/client";
import type { ConnectionStatus } from "../ws/socketClient";
import type { PresenceUser, VoiceParticipant } from "../ws/protocol";

export type AppState = {
  currentUser: CurrentUser | null;
  channels: Channel[];
  selectedChannelId: string | null;
  messagesByChannel: Record<string, Message[]>;
  unreadChannelIds: string[];
  unreadCounts: Record<string, number>;
  mentionChannelIds: string[];
  conversations: Conversation[];
  selectedConversationId: string | null;
  messagesByConversation: Record<string, Message[]>;
  unreadConversationIds: string[];
  unreadConversationCounts: Record<string, number>;
  onlineUserIds: string[];
  onlineUsers: PresenceUser[];
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
  unreadCounts: {},
  mentionChannelIds: [],
  conversations: [],
  selectedConversationId: null,
  messagesByConversation: {},
  unreadConversationIds: [],
  unreadConversationCounts: {},
  onlineUserIds: [],
  onlineUsers: [],
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
  | { type: "message/received"; message: Message; markUnread?: boolean; mention?: boolean }
  | { type: "message/updated"; message: Message }
  | { type: "message/deleted"; channelId?: string; conversationId?: string; messageId: string }
  | { type: "conversations/set"; conversations: Conversation[] }
  | { type: "conversation/added"; conversation: Conversation }
  | { type: "conversation/updated"; conversation: Conversation }
  | { type: "conversation/removed"; conversationId: string }
  | { type: "conversation/selected"; conversationId: string }
  | { type: "conversation-messages/loaded"; conversationId: string; messages: Message[] }
  | { type: "conversation-messages/prepended"; conversationId: string; messages: Message[] }
  | { type: "presence/sync"; userIds: string[]; users?: PresenceUser[] }
  | { type: "presence/online"; userId: string; user?: PresenceUser }
  | { type: "presence/offline"; userId: string }
  | { type: "voice/sync"; channels: Record<string, VoiceParticipant[]>; preserveChannelId?: string | null }
  | { type: "voice/channel-synced"; channelId: string; participants: VoiceParticipant[] }
  | { type: "voice/joined"; channelId: string; participant: VoiceParticipant }
  | { type: "voice/updated"; channelId: string; participant: VoiceParticipant }
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
      const unreadCounts = { ...state.unreadCounts };
      delete unreadCounts[action.channelId];
      return {
        ...state,
        selectedChannelId: action.channelId,
        selectedConversationId: null,
        unreadChannelIds: state.unreadChannelIds.filter((id) => id !== action.channelId),
        unreadCounts,
        mentionChannelIds: state.mentionChannelIds.filter((id) => id !== action.channelId),
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
      const { channelId, conversationId } = action.message;
      if (conversationId) {
        const existing = state.messagesByConversation[conversationId] ?? [];
        const shouldMarkUnread = action.markUnread !== false && action.message.userId !== state.currentUser?.id && conversationId !== state.selectedConversationId;
        return {
          ...state,
          messagesByConversation: { ...state.messagesByConversation, [conversationId]: [...existing, action.message] },
          unreadConversationIds: shouldMarkUnread && !state.unreadConversationIds.includes(conversationId)
            ? [...state.unreadConversationIds, conversationId]
            : state.unreadConversationIds,
          unreadConversationCounts: shouldMarkUnread ? { ...state.unreadConversationCounts, [conversationId]: (state.unreadConversationCounts[conversationId] ?? 0) + 1 } : state.unreadConversationCounts,
        };
      }
      const existing = state.messagesByChannel[channelId!] ?? [];
      const shouldMarkUnread = action.markUnread !== false && action.message.userId !== state.currentUser?.id && channelId !== state.selectedChannelId;
      return {
        ...state,
        messagesByChannel: { ...state.messagesByChannel, [channelId!]: [...existing, action.message] },
        unreadChannelIds: shouldMarkUnread && !state.unreadChannelIds.includes(channelId!)
          ? [...state.unreadChannelIds, channelId!]
          : state.unreadChannelIds,
        unreadCounts: shouldMarkUnread ? { ...state.unreadCounts, [channelId!]: (state.unreadCounts[channelId!] ?? 0) + 1 } : state.unreadCounts,
        mentionChannelIds: shouldMarkUnread && action.mention && !state.mentionChannelIds.includes(channelId!) ? [...state.mentionChannelIds, channelId!] : state.mentionChannelIds,
      };
    }
    case "message/updated": {
      const { channelId, conversationId } = action.message;
      if (conversationId) {
        const existing = state.messagesByConversation[conversationId] ?? [];
        return { ...state, messagesByConversation: { ...state.messagesByConversation, [conversationId]: existing.map((message) => message.id === action.message.id ? action.message : message) } };
      }
      const existing = state.messagesByChannel[channelId!] ?? [];
      return { ...state, messagesByChannel: { ...state.messagesByChannel, [channelId!]: existing.map((message) => message.id === action.message.id ? action.message : message) } };
    }
    case "message/deleted": {
      if (action.conversationId) {
        const existing = state.messagesByConversation[action.conversationId] ?? [];
        return { ...state, messagesByConversation: { ...state.messagesByConversation, [action.conversationId]: existing.filter((message) => message.id !== action.messageId) } };
      }
      const existing = state.messagesByChannel[action.channelId!] ?? [];
      return { ...state, messagesByChannel: { ...state.messagesByChannel, [action.channelId!]: existing.filter((message) => message.id !== action.messageId) } };
    }
    case "conversations/set":
      return { ...state, conversations: action.conversations };
    case "conversation/added":
      return state.conversations.some((c) => c.id === action.conversation.id)
        ? state
        : { ...state, conversations: [action.conversation, ...state.conversations] };
    case "conversation/updated":
      return {
        ...state,
        conversations: state.conversations.some((c) => c.id === action.conversation.id)
          ? state.conversations.map((c) => c.id === action.conversation.id ? action.conversation : c)
          : [action.conversation, ...state.conversations],
      };
    case "conversation/removed": {
      const conversations = state.conversations.filter((c) => c.id !== action.conversationId);
      const messagesByConversation = { ...state.messagesByConversation };
      delete messagesByConversation[action.conversationId];
      return {
        ...state,
        conversations,
        selectedConversationId: state.selectedConversationId === action.conversationId ? null : state.selectedConversationId,
        messagesByConversation,
        unreadConversationIds: state.unreadConversationIds.filter((id) => id !== action.conversationId),
      };
    }
    case "conversation/selected": {
      const unreadConversationCounts = { ...state.unreadConversationCounts };
      delete unreadConversationCounts[action.conversationId];
      return {
        ...state,
        selectedConversationId: action.conversationId,
        selectedChannelId: null,
        unreadConversationIds: state.unreadConversationIds.filter((id) => id !== action.conversationId),
        unreadConversationCounts,
      };
    }
    case "conversation-messages/loaded":
      return { ...state, messagesByConversation: { ...state.messagesByConversation, [action.conversationId]: action.messages } };
    case "conversation-messages/prepended": {
      const existing = state.messagesByConversation[action.conversationId] ?? [];
      return { ...state, messagesByConversation: { ...state.messagesByConversation, [action.conversationId]: [...action.messages, ...existing] } };
    }
    case "presence/sync":
      return { ...state, onlineUserIds: action.userIds, onlineUsers: action.users ?? state.onlineUsers };
    case "presence/online":
      return state.onlineUserIds.includes(action.userId)
        ? state
        : { ...state, onlineUserIds: [...state.onlineUserIds, action.userId], onlineUsers: action.user ? [...state.onlineUsers, action.user] : state.onlineUsers };
    case "presence/offline":
      return { ...state, onlineUserIds: state.onlineUserIds.filter((id) => id !== action.userId), onlineUsers: state.onlineUsers.filter((user) => user.id !== action.userId) };
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
    case "voice/updated": {
      const occupants = state.voiceOccupancy[action.channelId] ?? [];
      if (!occupants.some((participant) => participant.userId === action.participant.userId)) return state;
      return { ...state, voiceOccupancy: { ...state.voiceOccupancy, [action.channelId]: occupants.map((participant) => participant.userId === action.participant.userId ? action.participant : participant) } };
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
