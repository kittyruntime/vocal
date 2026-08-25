import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_SETTINGS, loadVoiceSettings } from "./settings";

function storageFor(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

describe("loadVoiceSettings", () => {
  it("loads old settings with custom defaults", () => {
    const settings = loadVoiceSettings(storageFor(JSON.stringify({ advancedMode: true })));
    expect(settings).toMatchObject({
      advancedMode: true,
      noiseReduction: true,
      audioQuality: "standard",
      cameraQuality: "standard",
      screenQuality: "standard",
      screenAudioQuality: "high",
      customAudio: { bitrateKbps: 48 },
      customCamera: { width: 1280, height: 720, frameRate: 30, bitrateKbps: 1700 },
      customScreen: { width: 1920, height: 1080, frameRate: 15, bitrateKbps: 2500 },
      customScreenAudio: { bitrateKbps: 96 },
    });
  });

  it("accepts complete valid custom settings", () => {
    const settings = loadVoiceSettings(storageFor(JSON.stringify({
      audioQuality: "custom", cameraQuality: "custom", screenQuality: "custom", screenAudioQuality: "custom",
      customAudio: { bitrateKbps: 64 },
      customCamera: { width: 1920, height: 1080, frameRate: 60, bitrateKbps: 8000 },
      customScreen: { width: 2560, height: 1440, frameRate: 30, bitrateKbps: 12000 },
      customScreenAudio: { bitrateKbps: 192 },
    })));
    expect(settings.audioQuality).toBe("custom");
    expect(settings.customCamera).toEqual({ width: 1920, height: 1080, frameRate: 60, bitrateKbps: 8000 });
    expect(settings.customScreenAudio.bitrateKbps).toBe(192);
  });

  it("falls back each malformed field independently", () => {
    const settings = loadVoiceSettings(storageFor(JSON.stringify({
      audioQuality: "ultra", screenQuality: "cinema",
      customAudio: { bitrateKbps: 15 },
      customCamera: { width: 3841, height: 1080, frameRate: null, bitrateKbps: "fast" },
      customScreen: { width: 640, height: 360, frameRate: 60, bitrateKbps: 30000 },
    })));
    expect(settings.audioQuality).toBe("standard");
    expect(settings.screenQuality).toBe("standard");
    expect(settings.customAudio.bitrateKbps).toBe(48);
    expect(settings.customCamera).toEqual({ width: 1280, height: 1080, frameRate: 30, bitrateKbps: 1700 });
    expect(settings.customScreen).toEqual({ width: 640, height: 360, frameRate: 60, bitrateKbps: 30000 });
  });

  it("falls back when access to the global localStorage property is denied", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });

    try {
      expect(loadVoiceSettings()).toEqual(DEFAULT_VOICE_SETTINGS);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("falls back for finite-range fields whose JSON numbers parse as non-finite", () => {
    const settings = loadVoiceSettings(storageFor(`{
      "customAudio": { "bitrateKbps": 1e400 },
      "customCamera": { "width": -1e400 }
    }`));

    expect(settings.customAudio.bitrateKbps).toBe(DEFAULT_VOICE_SETTINGS.customAudio.bitrateKbps);
    expect(settings.customCamera.width).toBe(DEFAULT_VOICE_SETTINGS.customCamera.width);
  });

  it("returns all defaults for invalid JSON", () => {
    expect(loadVoiceSettings(storageFor("{"))).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("respects an explicit noiseReduction: false, defaults to true when absent or malformed", () => {
    expect(loadVoiceSettings(storageFor(JSON.stringify({ noiseReduction: false }))).noiseReduction).toBe(false);
    expect(loadVoiceSettings(storageFor(JSON.stringify({}))).noiseReduction).toBe(true);
    expect(loadVoiceSettings(storageFor(JSON.stringify({ noiseReduction: "off" }))).noiseReduction).toBe(true);
  });
});
