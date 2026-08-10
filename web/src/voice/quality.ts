import type {
  AudioCaptureOptions,
  ScreenShareCaptureOptions,
  TrackPublishOptions,
  VideoCaptureOptions,
} from "livekit-client";

export type MediaQuality = "low" | "standard" | "high";
export type ScreenQuality = MediaQuality | "game";

export type QualityProfile<TCapture> = {
  label: string;
  detail: string;
  capture: TCapture;
  publish: TrackPublishOptions;
};

export const cameraProfiles: Record<MediaQuality, QualityProfile<VideoCaptureOptions>> = {
  low: {
    label: "Économie",
    detail: "360p · 20 ips · 450 kb/s",
    capture: { resolution: { width: 640, height: 360, frameRate: 20 } },
    publish: { videoEncoding: { maxBitrate: 450_000, maxFramerate: 20 }, simulcast: true },
  },
  standard: {
    label: "Équilibrée",
    detail: "720p · 30 ips · 1,7 Mb/s",
    capture: { resolution: { width: 1280, height: 720, frameRate: 30 } },
    publish: { videoEncoding: { maxBitrate: 1_700_000, maxFramerate: 30 }, simulcast: true },
  },
  high: {
    label: "Haute",
    detail: "1080p · 30 ips · 3 Mb/s",
    capture: { resolution: { width: 1920, height: 1080, frameRate: 30 } },
    publish: { videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 }, simulcast: true },
  },
};

export const screenProfiles: Record<ScreenQuality, QualityProfile<ScreenShareCaptureOptions>> = {
  low: {
    label: "Économie",
    detail: "720p · 5 ips · 800 kb/s",
    capture: { audio: true, resolution: { width: 1280, height: 720, frameRate: 5 }, contentHint: "text" },
    publish: { screenShareEncoding: { maxBitrate: 800_000, maxFramerate: 5 }, degradationPreference: "maintain-resolution" },
  },
  standard: {
    label: "Équilibrée",
    detail: "1080p · 15 ips · 2,5 Mb/s",
    capture: { audio: true, resolution: { width: 1920, height: 1080, frameRate: 15 }, contentHint: "detail" },
    publish: { screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 15 }, degradationPreference: "maintain-resolution" },
  },
  high: {
    label: "Fluide",
    detail: "1080p · 30 ips · 5 Mb/s",
    capture: { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: "motion" },
    publish: { screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 30 }, degradationPreference: "maintain-resolution" },
  },
  game: {
    label: "Jeu",
    detail: "1080p · 60 ips · 8 Mb/s",
    capture: { audio: true, resolution: { width: 1920, height: 1080, frameRate: 60 }, contentHint: "motion" },
    publish: { screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 }, degradationPreference: "maintain-framerate" },
  },
};

export const audioProfiles: Record<MediaQuality, QualityProfile<AudioCaptureOptions>> = {
  low: {
    label: "Économie",
    detail: "Voix · 24 kb/s",
    capture: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    publish: { audioPreset: { maxBitrate: 24_000 }, dtx: true, red: true, forceStereo: false },
  },
  standard: {
    label: "Claire",
    detail: "Voix HD · 48 kb/s",
    capture: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    publish: { audioPreset: { maxBitrate: 48_000 }, dtx: true, red: true, forceStereo: false },
  },
  high: {
    label: "Studio",
    detail: "Stéréo · 96 kb/s",
    capture: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 2 },
    publish: { audioPreset: { maxBitrate: 96_000 }, dtx: false, red: true, forceStereo: true },
  },
};
