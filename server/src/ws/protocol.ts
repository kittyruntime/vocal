export type MessagePayload = {
  id: string;
  channelId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  content: string;
  createdAt: string;
};

export type ChannelPayload = {
  id: string;
  name: string;
  type: string;
  requiredCapability: string | null;
  position: number;
  createdAt: string;
};

export type VoiceParticipantPayload = { userId: string; username: string };

export type ServerEvent =
  | { type: "presence.sync"; userIds: string[] }
  | { type: "presence.online"; userId: string }
  | { type: "presence.offline"; userId: string }
  | { type: "message.created"; message: MessagePayload }
  | { type: "channel.created"; channel: ChannelPayload }
  | { type: "channel.deleted"; channelId: string }
  | { type: "voice.sync"; channels: Record<string, VoiceParticipantPayload[]> }
  | { type: "voice.joined"; channelId: string; participant: VoiceParticipantPayload }
  | { type: "voice.left"; channelId: string; userId: string };

export type ClientEvent = { type: "ping" };
