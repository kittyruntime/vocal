import { describe, it, expect } from "vitest";
import { roleRank, hasAtLeastRole } from "../src/roles.js";

describe("role hierarchy", () => {
  it("ranks admin > moderator > member", () => {
    expect(roleRank("admin")).toBeGreaterThan(roleRank("moderator"));
    expect(roleRank("moderator")).toBeGreaterThan(roleRank("member"));
  });

  it("hasAtLeastRole compares by rank", () => {
    expect(hasAtLeastRole("admin", "member")).toBe(true);
    expect(hasAtLeastRole("moderator", "moderator")).toBe(true);
    expect(hasAtLeastRole("member", "moderator")).toBe(false);
  });
});
