import {
  customQualityDefaults,
  customQualityLimits,
  type CustomAudioSettings,
  type CustomMediaQuality,
  type CustomScreenQuality,
  type CustomVideoSettings,
} from "./quality";

export type DeviceSelections = Partial<Record<MediaDeviceKind, string>>;

export type VoiceSettings = {
  devices: DeviceSelections;
  vadThreshold: number;
  pushToTalk: boolean;
  audioQuality: CustomMediaQuality;
  cameraQuality: CustomMediaQuality;
  screenQuality: CustomScreenQuality;
  screenAudioQuality: CustomMediaQuality;
  customAudio: CustomAudioSettings;
  customCamera: CustomVideoSettings;
  customScreen: CustomVideoSettings;
  customScreenAudio: CustomAudioSettings;
  advancedMode: boolean;
};

export const SETTINGS_KEY = "vocal.voice-settings.v1";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  devices: {},
  vadThreshold: 0.15,
  pushToTalk: false,
  audioQuality: "standard",
  cameraQuality: "standard",
  screenQuality: "standard",
  screenAudioQuality: "high",
  customAudio: { ...customQualityDefaults.audio },
  customCamera: { ...customQualityDefaults.camera },
  customScreen: { ...customQualityDefaults.screen },
  customScreenAudio: { ...customQualityDefaults.screenAudio },
  advancedMode: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberWithin(value: unknown, fallback: number, { min, max }: { min: number; max: number }): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function customAudioSettings(value: unknown, fallback: CustomAudioSettings, limits: typeof customQualityLimits.audio): CustomAudioSettings {
  const parsed = isRecord(value) ? value : {};
  return {
    bitrateKbps: numberWithin(parsed.bitrateKbps, fallback.bitrateKbps, limits.bitrateKbps),
  };
}

function customVideoSettings(
  value: unknown,
  fallback: CustomVideoSettings,
  limits: typeof customQualityLimits.camera | typeof customQualityLimits.screen,
): CustomVideoSettings {
  const parsed = isRecord(value) ? value : {};
  return {
    width: numberWithin(parsed.width, fallback.width, limits.width),
    height: numberWithin(parsed.height, fallback.height, limits.height),
    frameRate: numberWithin(parsed.frameRate, fallback.frameRate, limits.frameRate),
    bitrateKbps: numberWithin(parsed.bitrateKbps, fallback.bitrateKbps, limits.bitrateKbps),
  };
}

function isMediaQuality(value: unknown): value is CustomMediaQuality {
  return value === "low" || value === "standard" || value === "high" || value === "custom";
}

function isScreenQuality(value: unknown): value is CustomScreenQuality {
  return isMediaQuality(value) || value === "game";
}

export function loadVoiceSettings(storage?: Pick<Storage, "getItem">): VoiceSettings {
  try {
    const resolvedStorage = storage ?? localStorage;
    const value = JSON.parse(resolvedStorage.getItem(SETTINGS_KEY) ?? "{}") as unknown;
    const parsed = isRecord(value) ? value : {};
    return {
      devices: isRecord(parsed.devices) ? parsed.devices as DeviceSelections : {},
      vadThreshold: typeof parsed.vadThreshold === "number" ? parsed.vadThreshold : DEFAULT_VOICE_SETTINGS.vadThreshold,
      pushToTalk: parsed.pushToTalk === true,
      audioQuality: isMediaQuality(parsed.audioQuality) ? parsed.audioQuality : DEFAULT_VOICE_SETTINGS.audioQuality,
      cameraQuality: isMediaQuality(parsed.cameraQuality) ? parsed.cameraQuality : DEFAULT_VOICE_SETTINGS.cameraQuality,
      screenQuality: isScreenQuality(parsed.screenQuality) ? parsed.screenQuality : DEFAULT_VOICE_SETTINGS.screenQuality,
      screenAudioQuality: isMediaQuality(parsed.screenAudioQuality) ? parsed.screenAudioQuality : DEFAULT_VOICE_SETTINGS.screenAudioQuality,
      customAudio: customAudioSettings(parsed.customAudio, DEFAULT_VOICE_SETTINGS.customAudio, customQualityLimits.audio),
      customCamera: customVideoSettings(parsed.customCamera, DEFAULT_VOICE_SETTINGS.customCamera, customQualityLimits.camera),
      customScreen: customVideoSettings(parsed.customScreen, DEFAULT_VOICE_SETTINGS.customScreen, customQualityLimits.screen),
      customScreenAudio: customAudioSettings(parsed.customScreenAudio, DEFAULT_VOICE_SETTINGS.customScreenAudio, customQualityLimits.screenAudio),
      advancedMode: parsed.advancedMode === true,
    };
  } catch {
    return {
      ...DEFAULT_VOICE_SETTINGS,
      devices: {},
      customAudio: { ...DEFAULT_VOICE_SETTINGS.customAudio },
      customCamera: { ...DEFAULT_VOICE_SETTINGS.customCamera },
      customScreen: { ...DEFAULT_VOICE_SETTINGS.customScreen },
      customScreenAudio: { ...DEFAULT_VOICE_SETTINGS.customScreenAudio },
    };
  }
}
