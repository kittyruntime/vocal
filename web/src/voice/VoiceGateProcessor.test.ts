import { describe, expect, it } from "vitest";
import { shouldOpenVoiceGate, VOICE_GATE_HOLD_MS } from "./VoiceGateProcessor";

describe("voice threshold gate", () => {
  it("opens above the configured threshold", () => {
    expect(shouldOpenVoiceGate(0.21, 0.2, 1_000, 0)).toBe(true);
  });

  it("holds briefly after speech then closes", () => {
    expect(shouldOpenVoiceGate(0.05, 0.2, 1_100, 1_000)).toBe(true);
    expect(shouldOpenVoiceGate(0.05, 0.2, 1_000 + VOICE_GATE_HOLD_MS, 1_000)).toBe(false);
  });
});
