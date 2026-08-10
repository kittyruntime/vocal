export type MessagePayload = {
  id: string;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
};

export type ChannelPayload = {
  id: string;
  name: string;
  type: string;
  minRole: string;
  position: number;
  createdAt: string;
};

export type ServerEvent =
  | { type: "presence.sync"; userIds: string[] }
  | { type: "presence.online"; userId: string }
  | { type: "presence.offline"; userId: string }
  | { type: "message.created"; message: MessagePayload }
  | { type: "channel.created"; channel: ChannelPayload }
  | { type: "channel.deleted"; channelId: string }
  | { type: "voice.sync"; channels: Record<string, string[]> }
  | { type: "voice.joined"; channelId: string; userId: string }
  | { type: "voice.left"; channelId: string; userId: string };

export type ClientEvent = { type: "ping" };
