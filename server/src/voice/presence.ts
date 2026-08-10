import type { VoiceParticipantPayload } from "../ws/protocol.js";

export interface VoicePresence {
  join(channelId: string, participant: VoiceParticipantPayload): void;
  leave(channelId: string, userId: string): void;
  occupants(channelId: string): VoiceParticipantPayload[];
  allOccupancy(): Record<string, VoiceParticipantPayload[]>;
}

export function createVoicePresence(): VoicePresence {
  const byChannel = new Map<string, Map<string, VoiceParticipantPayload>>();

  return {
    join(channelId, participant) {
      let users = byChannel.get(channelId);
      if (!users) {
        users = new Map();
        byChannel.set(channelId, users);
      }
      users.set(participant.userId, participant);
    },
    leave(channelId, userId) {
      const users = byChannel.get(channelId);
      if (!users) return;
      users.delete(userId);
      if (users.size === 0) byChannel.delete(channelId);
    },
    occupants(channelId) {
      return [...(byChannel.get(channelId)?.values() ?? [])];
    },
    allOccupancy() {
      const result: Record<string, VoiceParticipantPayload[]> = {};
      for (const [channelId, users] of byChannel) {
        result[channelId] = [...users.values()];
      }
      return result;
    },
  };
}
