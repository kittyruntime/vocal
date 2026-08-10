import type { Channel, Message } from "../api/client";

export type ServerEvent =
  | { type: "presence.sync"; userIds: string[] }
  | { type: "presence.online"; userId: string }
  | { type: "presence.offline"; userId: string }
  | { type: "message.created"; message: Message }
  | { type: "channel.created"; channel: Channel }
  | { type: "channel.deleted"; channelId: string }
  | { type: "voice.sync"; channels: Record<string, string[]> }
  | { type: "voice.joined"; channelId: string; userId: string }
  | { type: "voice.left"; channelId: string; userId: string }
  | { type: "pong" };
