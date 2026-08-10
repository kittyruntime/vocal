import { AccessToken } from "livekit-server-sdk";

export type LiveKitConfig = { apiKey: string; apiSecret: string; url: string };

export function loadLiveKitConfig(): LiveKitConfig {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    throw new Error("LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL must be set");
  }
  return { apiKey, apiSecret, url };
}

export async function mintVoiceToken(
  config: LiveKitConfig,
  input: { channelId: string; userId: string; username: string; avatarUrl?: string | null; canPublish: boolean },
): Promise<{ token: string; url: string }> {
  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.userId,
    name: input.username,
    metadata: JSON.stringify({ avatarUrl: input.avatarUrl ?? null }),
    ttl: "2m",
  });
  at.addGrant({
    roomJoin: true,
    room: input.channelId,
    canPublish: input.canPublish,
    canSubscribe: true,
  });
  const token = await at.toJwt();
  return { token, url: config.url };
}
