import type { Channel, Conversation, Message } from "../api/client";

export type VoiceParticipant = {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  microphoneMuted?: boolean;
  deafened?: boolean;
};
export type PresenceUser = { id: string; username: string; avatarUrl: string | null };

export type ServerEvent =
  | { type: "presence.sync"; userIds: string[]; users?: PresenceUser[] }
  | { type: "presence.online"; userId: string; user?: PresenceUser }
  | { type: "presence.offline"; userId: string }
  | { type: "message.created"; message: Message }
  | { type: "message.updated"; message: Message }
  | { type: "message.deleted"; channelId?: string; conversationId?: string; messageId: string }
  | { type: "typing.updated"; channelId?: string; conversationId?: string; userId: string; username: string; active: boolean }
  | { type: "channel.created"; channel: Channel }
  | { type: "channel.deleted"; channelId: string }
  | { type: "conversation.created"; conversation: Conversation }
  | { type: "conversation.updated"; conversation: Conversation }
  | { type: "conversation.removed"; conversationId: string }
  | { type: "voice.sync"; channels: Record<string, VoiceParticipant[]> }
  | { type: "voice.joined"; channelId: string; participant: VoiceParticipant }
  | { type: "voice.updated"; channelId: string; participant: VoiceParticipant }
  | { type: "voice.left"; channelId: string; userId: string }
  | { type: "pong" };

export type ClientEvent =
  | { type: "ping" }
  | { type: "typing.update"; channelId?: string; conversationId?: string; active: boolean }
  | { type: "voice.status"; channelId: string; microphoneMuted: boolean; deafened: boolean };
