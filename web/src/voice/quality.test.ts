import { describe, expect, it } from "vitest";
import { audioProfiles, cameraProfiles, screenProfiles } from "./quality";

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
});
