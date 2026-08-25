import { describe, expect, it } from "vitest";
import {
  audioProfiles,
  cameraProfiles,
  customQualityDefaults,
  resolveAudioProfile,
  resolveCameraProfile,
  resolveScreenProfile,
  screenProfiles,
} from "./quality";

describe("media quality profiles", () => {
  it("increases camera resolution and bitrate across profiles", () => {
    expect(cameraProfiles.low.capture.resolution).toMatchObject({ width: 640, height: 360 });
    expect(cameraProfiles.high.publish.videoEncoding?.maxBitrate)
      .toBeGreaterThan(cameraProfiles.standard.publish.videoEncoding?.maxBitrate ?? 0);
  });

  it("prioritizes screen readability and offers a 30 fps profile", () => {
    expect(screenProfiles.standard.publish.degradationPreference).toBe("maintain-resolution");
    expect(screenProfiles.high.capture.resolution).toMatchObject({ width: 1920, frameRate: 30 });
  });

  it("offers a 1080p60 game screen-sharing profile", () => {
    expect(screenProfiles.game.capture.resolution).toMatchObject({ width: 1920, height: 1080, frameRate: 60 });
    expect(screenProfiles.game.publish.screenShareEncoding).toMatchObject({ maxFramerate: 60, maxBitrate: 8_000_000 });
    expect(screenProfiles.game.publish.degradationPreference).toBe("maintain-framerate");
  });

  it("offers mono voice and high quality stereo audio", () => {
    expect(audioProfiles.low.publish.forceStereo).toBe(false);
    expect(audioProfiles.high.publish).toMatchObject({ forceStereo: true, dtx: false });
  });

  it("offers an ultra tier above high for audio, camera, and screen share", () => {
    expect(audioProfiles.ultra.publish.audioPreset?.maxBitrate).toBeGreaterThan(audioProfiles.high.publish.audioPreset?.maxBitrate ?? 0);
    expect(cameraProfiles.ultra.publish.videoEncoding?.maxBitrate).toBeGreaterThan(cameraProfiles.high.publish.videoEncoding?.maxBitrate ?? 0);
    expect(cameraProfiles.ultra.capture.resolution).toMatchObject({ width: 2560, height: 1440 });
    expect(screenProfiles.ultra.capture.resolution).toMatchObject({ width: 2560, height: 1440 });
  });

  it("returns existing preset objects unchanged", () => {
    expect(resolveAudioProfile("low", { bitrateKbps: 64 }, "microphone")).toBe(audioProfiles.low);
    expect(resolveCameraProfile("high", customQualityDefaults.camera)).toBe(cameraProfiles.high);
    expect(resolveScreenProfile("game", customQualityDefaults.screen)).toBe(screenProfiles.game);
  });

  it("builds distinct custom microphone and screen-audio profiles", () => {
    expect(resolveAudioProfile("custom", { bitrateKbps: 80 }, "microphone")).toMatchObject({
      capture: { channelCount: 1 },
      publish: { audioPreset: { maxBitrate: 80_000 }, dtx: true, red: true, forceStereo: false },
    });
    expect(resolveAudioProfile("custom", { bitrateKbps: 160 }, "screenShare")).toMatchObject({
      publish: { audioPreset: { maxBitrate: 160_000 }, dtx: false, red: true, forceStereo: true },
    });
  });

  it("builds a custom simulcast webcam profile", () => {
    expect(resolveCameraProfile("custom", { width: 2560, height: 1440, frameRate: 50, bitrateKbps: 9000 })).toEqual({
      label: "Custom",
      detail: "2560×1440 · 50 fps · 9000 kb/s",
      capture: { resolution: { width: 2560, height: 1440, frameRate: 50 } },
      publish: { videoEncoding: { maxBitrate: 9_000_000, maxFramerate: 50 }, simulcast: true },
    });
  });

  it("changes custom screen-share strategy at 30 fps", () => {
    expect(resolveScreenProfile("custom", { width: 1600, height: 900, frameRate: 29, bitrateKbps: 4000 })).toMatchObject({
      capture: { audio: true, resolution: { width: 1600, height: 900, frameRate: 29 }, contentHint: "detail" },
      publish: { screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 29 }, degradationPreference: "maintain-resolution" },
    });
    expect(resolveScreenProfile("custom", { width: 1920, height: 1080, frameRate: 30, bitrateKbps: 6000 })).toMatchObject({
      capture: { contentHint: "motion" },
      publish: { degradationPreference: "maintain-framerate" },
    });
  });
});
