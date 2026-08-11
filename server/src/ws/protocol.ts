export type MessagePayload = {
  id: string;
  channelId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  replyTo?: MessageReplyPayload | null;
  reactions?: MessageReactionPayload[];
  attachments?: MessageAttachmentPayload[];
};

export type MessageReplyPayload = { id: string; userId: string; username: string; content: string };
export type MessageReactionPayload = { emoji: string; count: number; userIds: string[] };

export type MessageAttachmentPayload = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
};

export type ChannelPayload = {
  id: string;
  name: string;
  type: string;
  requiredCapability: string | null;
  position: number;
  createdAt: string;
};

export type VoiceParticipantPayload = { userId: string; username: string; avatarUrl?: string | null };

export type ServerEvent =
  | { type: "presence.sync"; userIds: string[] }
  | { type: "presence.online"; userId: string }
  | { type: "presence.offline"; userId: string }
  | { type: "message.created"; message: MessagePayload }
  | { type: "message.updated"; message: MessagePayload }
  | { type: "message.deleted"; channelId: string; messageId: string }
  | { type: "typing.updated"; channelId: string; userId: string; username: string; active: boolean }
  | { type: "channel.created"; channel: ChannelPayload }
  | { type: "channel.deleted"; channelId: string }
  | { type: "voice.sync"; channels: Record<string, VoiceParticipantPayload[]> }
  | { type: "voice.joined"; channelId: string; participant: VoiceParticipantPayload }
  | { type: "voice.left"; channelId: string; userId: string };

export type ClientEvent = { type: "ping" } | { type: "typing.update"; channelId: string; active: boolean };
