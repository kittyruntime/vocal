import { RoomServiceClient } from "livekit-server-sdk";
import type { LiveKitConfig } from "./tokens.js";

export interface VoiceAdminService {
  setParticipantPublishing(room: string, identity: string, canPublish: boolean): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
}

function serviceUrl(url: string): string {
  if (url.startsWith("wss://")) return `https://${url.slice(6)}`;
  if (url.startsWith("ws://")) return `http://${url.slice(5)}`;
  return url;
}

export function createVoiceAdminService(config: LiveKitConfig): VoiceAdminService {
  const client = new RoomServiceClient(serviceUrl(config.url), config.apiKey, config.apiSecret);
  return {
    async setParticipantPublishing(room, identity, canPublish) {
      await client.updateParticipant(room, identity, {
        permission: {
          canSubscribe: true,
          canPublish,
          canPublishData: true,
          canUpdateMetadata: true,
        },
      });
    },
    async removeParticipant(room, identity) {
      await client.removeParticipant(room, identity, { revokeTokenTs: BigInt(Date.now()) });
    },
  };
}
