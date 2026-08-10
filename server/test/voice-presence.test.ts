import { describe, it, expect } from "vitest";
import { createVoicePresence } from "../src/voice/presence.js";

describe("voice presence", () => {
  it("starts empty", () => {
    const presence = createVoicePresence();
    expect(presence.occupants("c1")).toEqual([]);
    expect(presence.allOccupancy()).toEqual({});
  });

  it("tracks who joined which channel", () => {
    const presence = createVoicePresence();
    presence.join("c1", "u1");
    presence.join("c1", "u2");
    presence.join("c2", "u1");
    expect(presence.occupants("c1").sort()).toEqual(["u1", "u2"]);
    expect(presence.occupants("c2")).toEqual(["u1"]);
    expect(presence.allOccupancy()).toEqual({ c1: expect.arrayContaining(["u1", "u2"]), c2: ["u1"] });
  });

  it("is idempotent — joining twice doesn't duplicate", () => {
    const presence = createVoicePresence();
    presence.join("c1", "u1");
    presence.join("c1", "u1");
    expect(presence.occupants("c1")).toEqual(["u1"]);
  });

  it("removes a channel entry once everyone has left", () => {
    const presence = createVoicePresence();
    presence.join("c1", "u1");
    presence.leave("c1", "u1");
    expect(presence.occupants("c1")).toEqual([]);
    expect(presence.allOccupancy()).toEqual({});
  });

  it("leaving a channel you were never in is a no-op", () => {
    const presence = createVoicePresence();
    expect(() => presence.leave("c1", "u1")).not.toThrow();
    expect(presence.occupants("c1")).toEqual([]);
  });
});
