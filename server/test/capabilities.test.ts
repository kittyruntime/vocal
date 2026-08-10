import { describe, it, expect } from "vitest";
import { CAPABILITIES } from "../src/capabilities.js";

describe("capabilities", () => {
  it("is a closed, non-empty set of distinct string values", () => {
    expect(CAPABILITIES.length).toBeGreaterThan(0);
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });
});
