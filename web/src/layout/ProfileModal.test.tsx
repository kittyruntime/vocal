import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../api/client";
import { ProfileModal } from "./ProfileModal";

vi.mock("../api/client", async () => ({
  ...(await vi.importActual<typeof import("../api/client")>("../api/client")),
  updateProfile: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("ProfileModal", () => {
  it("edits and saves account details", async () => {
    vi.mocked(api.updateProfile).mockResolvedValue({ id: "u1", username: "theophile", capabilities: [] });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", email: "old@example.com", description: "Old", capabilities: [] }} onSaved={onSaved} onClose={onClose} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), "theophile");
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "theo@example.com");
    await user.clear(screen.getByLabelText("About me"));
    await user.type(screen.getByLabelText("About me"), "Hello there");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({
      username: "theophile", email: "theo@example.com", description: "Hello there", avatarUrl: null, bannerUrl: null,
    }));
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows API validation errors", async () => {
    vi.mocked(api.updateProfile).mockRejectedValue(new Error("username taken"));
    render(<ProfileModal currentUser={{ id: "u1", username: "theo", capabilities: [] }} onSaved={vi.fn()} onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("username taken");
  });
});
