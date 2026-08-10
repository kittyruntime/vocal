import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChannelSettingsModal } from "./ChannelSettingsModal";
import * as api from "../api/client";
import type { Channel } from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, updateChannel: vi.fn(), deleteChannel: vi.fn() };
});

const textChannel: Channel = { id: "c1", name: "general", type: "text", minRole: "member", position: 0, createdAt: "now" };
const voiceChannel: Channel = { id: "c2", name: "lounge", type: "voice", minRole: "member", position: 1, createdAt: "now" };

beforeEach(() => {
  vi.mocked(api.updateChannel).mockReset();
  vi.mocked(api.deleteChannel).mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("ChannelSettingsModal", () => {
  it("saves a renamed channel and closes", async () => {
    const updated: Channel = { ...textChannel, name: "renamed" };
    vi.mocked(api.updateChannel).mockResolvedValue(updated);
    const onUpdated = vi.fn();
    const onClose = vi.fn();
    render(<ChannelSettingsModal channel={textChannel} onUpdated={onUpdated} onDeleted={vi.fn()} onClose={onClose} />);
    const user = userEvent.setup();
    const nameInput = screen.getByLabelText("Name of general");
    await user.clear(nameInput);
    await user.type(nameInput, "renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.updateChannel).toHaveBeenCalledWith("c1", expect.objectContaining({ name: "renamed" }));
    expect(onUpdated).toHaveBeenCalledWith(updated);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not show quality settings for a text channel", () => {
    render(<ChannelSettingsModal channel={textChannel} onUpdated={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("Default media quality")).not.toBeInTheDocument();
  });

  it("shows quality settings for a voice channel", () => {
    render(<ChannelSettingsModal channel={voiceChannel} onUpdated={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Default media quality")).toBeInTheDocument();
  });

  it("deletes the channel after confirmation", async () => {
    vi.mocked(api.deleteChannel).mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    render(<ChannelSettingsModal channel={textChannel} onUpdated={vi.fn()} onDeleted={onDeleted} onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteChannel).toHaveBeenCalledWith("c1");
    expect(onDeleted).toHaveBeenCalledWith("c1");
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ChannelSettingsModal channel={textChannel} onUpdated={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteChannel).not.toHaveBeenCalled();
  });

  it("closes when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<ChannelSettingsModal channel={textChannel} onUpdated={vi.fn()} onDeleted={vi.fn()} onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close channel settings" }));
    expect(onClose).toHaveBeenCalled();
  });
});
