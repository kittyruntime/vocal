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

  it("offers a Message button that starts a conversation with that user", async () => {
    vi.mocked(api.getPublicProfile).mockResolvedValue({ id: "u2", username: "alice", description: "", avatarUrl: null, bannerUrl: null });
    const onMessage = vi.fn();
    render(<UserProfileModal userId="u2" currentUserId="u1" onClose={vi.fn()} onMessage={onMessage} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Message" }));
    expect(onMessage).toHaveBeenCalledWith("u2");
  });

  it("hides the Message button on your own profile", async () => {
    vi.mocked(api.getPublicProfile).mockResolvedValue({ id: "u1", username: "me", description: "", avatarUrl: null, bannerUrl: null });
    render(<UserProfileModal userId="u1" currentUserId="u1" onClose={vi.fn()} onMessage={vi.fn()} />);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Message" })).not.toBeInTheDocument();
  });
});
