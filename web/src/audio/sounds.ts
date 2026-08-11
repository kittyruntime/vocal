import { SOUND_EVENTS, type SoundEvent, type SoundSettings, type SoundVolumes } from "../api/client";

export type { SoundEvent };

const DEFAULT_VOLUME = 55;

const defaultSources: Record<SoundEvent, string> = {
  message: "/sounds/message-received.mp3",
  userJoin: "/sounds/user-join.mp3",
  userLeave: "/sounds/user-leave.mp3",
  muteToggle: "/sounds/mute-toggle.mp3",
  forceMuted: "/sounds/force-muted.mp3",
};

let settings: SoundSettings = Object.fromEntries(
  SOUND_EVENTS.map((event) => [event, { enabled: true, hasCustom: false }]),
) as SoundSettings;
let volumes: SoundVolumes = Object.fromEntries(
  SOUND_EVENTS.map((event) => [event, DEFAULT_VOLUME]),
) as SoundVolumes;

export function configureSounds(nextSettings: SoundSettings, nextVolumes: SoundVolumes): void {
  settings = nextSettings;
  volumes = nextVolumes;
}

export function soundSourceFor(event: SoundEvent, hasCustom: boolean): string {
  return hasCustom ? `/api/sounds/${event}/file` : defaultSources[event];
}

export function previewSound(event: SoundEvent, hasCustom: boolean, volumePercent: number = DEFAULT_VOLUME): void {
  const audio = new Audio(soundSourceFor(event, hasCustom));
  audio.volume = volumePercent / 100;
  void audio.play().catch(() => {
    // Browsers can block audio until the first user interaction.
  });
}

export function playAppSound(sound: SoundEvent): void {
  if (!settings[sound].enabled) return;
  previewSound(sound, settings[sound].hasCustom, volumes[sound] ?? DEFAULT_VOLUME);
}
