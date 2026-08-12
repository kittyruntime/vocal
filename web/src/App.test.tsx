import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...actual,
    getSetupStatus: vi.fn(() => new Promise(() => {})),
    // App's mount effect calls applyServerDefaultAccent(), which calls getAppearance().
    // Mock it so this test doesn't fire a real, unmocked fetch.
    getAppearance: vi.fn(() => new Promise(() => {})),
  };
});

describe("App", () => {
  it("shows a loading state while auth is bootstrapping", () => {
    render(<App />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
