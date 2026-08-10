export type AppSound = "message" | "userJoin" | "userLeave";

const sources: Record<AppSound, string> = {
  message: "/sounds/message-received.mp3",
  userJoin: "/sounds/user-join.mp3",
  userLeave: "/sounds/user-leave.mp3",
};

export function playAppSound(sound: AppSound): void {
  const audio = new Audio(sources[sound]);
  audio.volume = 0.55;
  void audio.play().catch(() => {
    // Browsers can block audio until the first user interaction.
  });
}
