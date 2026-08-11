import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOUND_EVENTS, type SoundSettings, type SoundVolumes } from "../api/client";
import { configureSounds, playAppSound, previewSound, soundSourceFor } from "./sounds";

class FakeAudio {
  static instances: FakeAudio[] = [];
  volume = 1;
  src: string;
  constructor(src: string) { this.src = src; FakeAudio.instances.push(this); }
  play() { return Promise.resolve(); }
}

function settingsFor(overrides: Partial<Record<string, { enabled: boolean; hasCustom: boolean }>>): SoundSettings {
  const base = Object.fromEntries(SOUND_EVENTS.map((event) => [event, { enabled: true, hasCustom: false }]));
  return { ...base, ...overrides } as SoundSettings;
}

function volumesFor(overrides: Partial<Record<string, number>>): SoundVolumes {
  const base = Object.fromEntries(SOUND_EVENTS.map((event) => [event, 55]));
  return { ...base, ...overrides } as SoundVolumes;
}

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
});

describe("audio/sounds", () => {
  it("does not play a sound the server has disabled", () => {
    configureSounds(settingsFor({ message: { enabled: false, hasCustom: false } }), volumesFor({}));
    playAppSound("message");
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("plays the default source at the configured volume when enabled", () => {
    configureSounds(settingsFor({}), volumesFor({ message: 80 }));
    playAppSound("message");
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe("/sounds/message-received.mp3");
    expect(FakeAudio.instances[0].volume).toBe(0.8);
  });

  it("plays the custom uploaded source when hasCustom is true", () => {
    configureSounds(settingsFor({ userJoin: { enabled: true, hasCustom: true } }), volumesFor({}));
    playAppSound("userJoin");
    expect(FakeAudio.instances[0].src).toBe("/api/sounds/userJoin/file");
  });

  it("soundSourceFor resolves default vs custom", () => {
    expect(soundSourceFor("userLeave", false)).toBe("/sounds/user-leave.mp3");
    expect(soundSourceFor("userLeave", true)).toBe("/api/sounds/userLeave/file");
  });

  it("previewSound plays regardless of the enabled flag, defaulting to 55% volume", () => {
    previewSound("muteToggle", false);
    expect(FakeAudio.instances[0].src).toBe("/sounds/mute-toggle.mp3");
    expect(FakeAudio.instances[0].volume).toBe(0.55);
  });
});
