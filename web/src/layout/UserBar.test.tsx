import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserBar } from "./UserBar";

describe("UserBar", () => {
  it("shows the current user's name and role", () => {
    render(<UserBar currentUser={{ id: "1", username: "theo", capabilities: ["moderate"] }} onOpenProfile={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByText("theo")).toBeInTheDocument();
    expect(screen.getByText("Staff")).toBeInTheDocument();
  });

  it("calls onSignOut when clicking the logout button", async () => {
    const onSignOut = vi.fn();
    render(<UserBar currentUser={{ id: "1", username: "theo", capabilities: [] }} onOpenProfile={vi.fn()} onSignOut={onSignOut} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("opens the profile settings", async () => {
    const onOpenProfile = vi.fn();
    render(<UserBar currentUser={{ id: "1", username: "theo", capabilities: [] }} onOpenProfile={onOpenProfile} onSignOut={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "User settings" }));
    expect(onOpenProfile).toHaveBeenCalled();
  });
});
