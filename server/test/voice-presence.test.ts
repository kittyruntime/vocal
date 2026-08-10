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
    presence.join("c1", { userId: "u1", username: "Theo" });
    presence.join("c1", { userId: "u2", username: "Alice" });
    presence.join("c2", { userId: "u1", username: "Theo" });
    expect(presence.occupants("c1")).toEqual([
      { userId: "u1", username: "Theo" },
      { userId: "u2", username: "Alice" },
    ]);
    expect(presence.occupants("c2")).toEqual([{ userId: "u1", username: "Theo" }]);
    expect(presence.allOccupancy()).toEqual({
      c1: [{ userId: "u1", username: "Theo" }, { userId: "u2", username: "Alice" }],
      c2: [{ userId: "u1", username: "Theo" }],
    });
  });

  it("is idempotent — joining twice doesn't duplicate", () => {
    const presence = createVoicePresence();
    presence.join("c1", { userId: "u1", username: "Theo" });
    presence.join("c1", { userId: "u1", username: "Theo" });
    expect(presence.occupants("c1")).toEqual([{ userId: "u1", username: "Theo" }]);
  });

  it("removes a channel entry once everyone has left", () => {
    const presence = createVoicePresence();
    presence.join("c1", { userId: "u1", username: "Theo" });
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
