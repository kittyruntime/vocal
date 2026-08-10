export interface VoicePresence {
  join(channelId: string, userId: string): void;
  leave(channelId: string, userId: string): void;
  occupants(channelId: string): string[];
  allOccupancy(): Record<string, string[]>;
}

export function createVoicePresence(): VoicePresence {
  const byChannel = new Map<string, Set<string>>();

  return {
    join(channelId, userId) {
      let users = byChannel.get(channelId);
      if (!users) {
        users = new Set();
        byChannel.set(channelId, users);
      }
      users.add(userId);
    },
    leave(channelId, userId) {
      const users = byChannel.get(channelId);
      if (!users) return;
      users.delete(userId);
      if (users.size === 0) byChannel.delete(channelId);
    },
    occupants(channelId) {
      return [...(byChannel.get(channelId) ?? [])];
    },
    allOccupancy() {
      const result: Record<string, string[]> = {};
      for (const [channelId, users] of byChannel) {
        result[channelId] = [...users];
      }
      return result;
    },
  };
}
