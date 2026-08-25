import type {
  AudioCaptureOptions,
  ScreenShareCaptureOptions,
  TrackPublishOptions,
  VideoCaptureOptions,
} from "livekit-client";

export type MediaQuality = "low" | "standard" | "high" | "ultra";
export type ScreenQuality = MediaQuality | "game";
export type CustomMediaQuality = MediaQuality | "custom";
export type CustomScreenQuality = ScreenQuality | "custom";
export type CustomAudioSettings = { bitrateKbps: number };
export type CustomVideoSettings = { width: number; height: number; frameRate: number; bitrateKbps: number };

export type QualityProfile<TCapture> = {
  label: string;
  detail: string;
  capture: TCapture;
  publish: TrackPublishOptions;
};

export const cameraProfiles: Record<MediaQuality, QualityProfile<VideoCaptureOptions>> = {
  low: {
    label: "Data saver",
    detail: "360p · 20 fps · 450 kb/s",
    capture: { resolution: { width: 640, height: 360, frameRate: 20 } },
    publish: { videoEncoding: { maxBitrate: 450_000, maxFramerate: 20 }, simulcast: true },
  },
  standard: {
    label: "Balanced",
    detail: "720p · 30 fps · 1.7 Mb/s",
    capture: { resolution: { width: 1280, height: 720, frameRate: 30 } },
    publish: { videoEncoding: { maxBitrate: 1_700_000, maxFramerate: 30 }, simulcast: true },
  },
  high: {
    label: "High",
    detail: "1080p · 30 fps · 3 Mb/s",
    capture: { resolution: { width: 1920, height: 1080, frameRate: 30 } },
    publish: { videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 }, simulcast: true },
  },
  ultra: {
    label: "Ultra",
    detail: "1440p · 30 fps · 6 Mb/s",
    capture: { resolution: { width: 2560, height: 1440, frameRate: 30 } },
    publish: { videoEncoding: { maxBitrate: 6_000_000, maxFramerate: 30 }, simulcast: true },
  },
};

export const screenProfiles: Record<ScreenQuality, QualityProfile<ScreenShareCaptureOptions>> = {
  low: {
    label: "Data saver",
    detail: "720p · 5 fps · 800 kb/s",
    capture: { audio: true, resolution: { width: 1280, height: 720, frameRate: 5 }, contentHint: "text" },
    publish: { screenShareEncoding: { maxBitrate: 800_000, maxFramerate: 5 }, degradationPreference: "maintain-resolution" },
  },
  standard: {
    label: "Balanced",
    detail: "1080p · 15 fps · 2.5 Mb/s",
    capture: { audio: true, resolution: { width: 1920, height: 1080, frameRate: 15 }, contentHint: "detail" },
    publish: { screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 15 }, degradationPreference: "maintain-resolution" },
  },
  high: {
    label: "Smooth",
    detail: "1080p · 30 fps · 5 Mb/s",
    capture: { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: "motion" },
    publish: { screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 30 }, degradationPreference: "maintain-resolution" },
  },
  game: {
    label: "Game",
    detail: "1080p · 60 fps · 8 Mb/s",
    capture: { audio: true, resolution: { width: 1920, height: 1080, frameRate: 60 }, contentHint: "motion" },
    publish: { screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 }, degradationPreference: "maintain-framerate" },
  },
  ultra: {
    label: "Ultra",
    detail: "1440p · 60 fps · 12 Mb/s",
    capture: { audio: true, resolution: { width: 2560, height: 1440, frameRate: 60 }, contentHint: "motion" },
    publish: { screenShareEncoding: { maxBitrate: 12_000_000, maxFramerate: 60 }, degradationPreference: "maintain-framerate" },
  },
};

export const audioProfiles: Record<MediaQuality, QualityProfile<AudioCaptureOptions>> = {
  low: {
    label: "Data saver",
    detail: "Voice · 24 kb/s",
    capture: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    publish: { audioPreset: { maxBitrate: 24_000 }, dtx: true, red: true, forceStereo: false },
  },
  standard: {
    label: "Clear",
    detail: "HD voice · 48 kb/s",
    capture: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    publish: { audioPreset: { maxBitrate: 48_000 }, dtx: true, red: true, forceStereo: false },
  },
  high: {
    label: "Studio",
    detail: "Stereo · 96 kb/s",
    capture: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 2 },
    publish: { audioPreset: { maxBitrate: 96_000 }, dtx: false, red: true, forceStereo: true },
  },
  ultra: {
    label: "Ultra",
    detail: "Stereo · 128 kb/s",
    capture: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 2 },
    publish: { audioPreset: { maxBitrate: 128_000 }, dtx: false, red: true, forceStereo: true },
  },
};

export const customQualityDefaults = {
  audio: { bitrateKbps: 48 },
  camera: { width: 1280, height: 720, frameRate: 30, bitrateKbps: 1700 },
  screen: { width: 1920, height: 1080, frameRate: 15, bitrateKbps: 2500 },
  screenAudio: { bitrateKbps: 96 },
} as const;

export const customQualityLimits = {
  audio: { bitrateKbps: { min: 16, max: 320, step: 8 } },
  camera: {
    width: { min: 320, max: 3840, step: 1 }, height: { min: 180, max: 2160, step: 1 },
    frameRate: { min: 5, max: 60, step: 1 }, bitrateKbps: { min: 100, max: 20_000, step: 100 },
  },
  screen: {
    width: { min: 640, max: 3840, step: 1 }, height: { min: 360, max: 2160, step: 1 },
    frameRate: { min: 1, max: 60, step: 1 }, bitrateKbps: { min: 200, max: 30_000, step: 100 },
  },
  screenAudio: { bitrateKbps: { min: 16, max: 320, step: 8 } },
} as const;

export function resolveAudioProfile(
  quality: CustomMediaQuality,
  custom: CustomAudioSettings,
  source: "microphone" | "screenShare",
): QualityProfile<AudioCaptureOptions> {
  if (quality !== "custom") return audioProfiles[quality];
  const base = source === "microphone" ? audioProfiles.standard : audioProfiles.high;
  return {
    label: "Custom",
    detail: `${source === "microphone" ? "Voice" : "Stereo"} · ${custom.bitrateKbps} kb/s`,
    capture: { ...base.capture },
    publish: { ...base.publish, audioPreset: { maxBitrate: custom.bitrateKbps * 1_000 } },
  };
}

export function resolveCameraProfile(
  quality: CustomMediaQuality,
  custom: CustomVideoSettings,
): QualityProfile<VideoCaptureOptions> {
  if (quality !== "custom") return cameraProfiles[quality];
  return {
    label: "Custom",
    detail: `${custom.width}×${custom.height} · ${custom.frameRate} fps · ${custom.bitrateKbps} kb/s`,
    capture: { resolution: { width: custom.width, height: custom.height, frameRate: custom.frameRate } },
    publish: { videoEncoding: { maxBitrate: custom.bitrateKbps * 1_000, maxFramerate: custom.frameRate }, simulcast: true },
  };
}

export function resolveScreenProfile(
  quality: CustomScreenQuality,
  custom: CustomVideoSettings,
): QualityProfile<ScreenShareCaptureOptions> {
  if (quality !== "custom") return screenProfiles[quality];
  const smooth = custom.frameRate >= 30;
  return {
    label: "Custom",
    detail: `${custom.width}×${custom.height} · ${custom.frameRate} fps · ${custom.bitrateKbps} kb/s`,
    capture: {
      audio: true,
      resolution: { width: custom.width, height: custom.height, frameRate: custom.frameRate },
      contentHint: smooth ? "motion" : "detail",
    },
    publish: {
      screenShareEncoding: { maxBitrate: custom.bitrateKbps * 1_000, maxFramerate: custom.frameRate },
      degradationPreference: smooth ? "maintain-framerate" : "maintain-resolution",
    },
  };
}
