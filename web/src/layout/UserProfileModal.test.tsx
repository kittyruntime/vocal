import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../api/client";
import { UserProfileModal } from "./UserProfileModal";

vi.mock("../api/client", async () => ({
  ...(await vi.importActual<typeof import("../api/client")>("../api/client")),
  getPublicProfile: vi.fn(),
}));

describe("UserProfileModal", () => {
  it("shows a public profile without private account fields", async () => {
    vi.mocked(api.getPublicProfile).mockResolvedValue({ id: "u2", username: "alice", description: "Hello!", avatarUrl: "/avatar", bannerUrl: "/banner" });
    render(<UserProfileModal userId="u2" onClose={vi.fn()} />);
    expect(await screen.findByRole("dialog", { name: "Profile of alice" })).toBeInTheDocument();
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(document.querySelector(".public-profile-avatar img")).toHaveAttribute("src", "/avatar");
  });

  it("closes from its close button", async () => {
    vi.mocked(api.getPublicProfile).mockResolvedValue({ id: "u2", username: "alice", description: "", avatarUrl: null, bannerUrl: null });
    const onClose = vi.fn();
    render(<UserProfileModal userId="u2" onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close user profile" }));
    expect(onClose).toHaveBeenCalled();
  });
});
