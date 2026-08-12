import { describe, it, expect } from "vitest";
import { resolveAccent } from "./accent";

describe("resolveAccent", () => {
  it("uses the user's preset when it is set and enabled", () => {
    expect(resolveAccent("magenta", ["amber", "magenta"], "amber")).toBe("magenta");
  });

  it("falls back to the server default when the user has no preference", () => {
    expect(resolveAccent(null, ["amber", "magenta"], "amber")).toBe("amber");
  });

  it("falls back to the server default when the user's stored preset was since disabled", () => {
    expect(resolveAccent("magenta", ["amber", "glacier"], "amber")).toBe("amber");
  });
});
