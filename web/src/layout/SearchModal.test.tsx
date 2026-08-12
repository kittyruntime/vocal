import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchModal } from "./SearchModal";
import * as api from "../api/client";

vi.mock("../api/client", async () => ({
  ...(await vi.importActual<typeof import("../api/client")>("../api/client")),
  search: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api.search).mockReset();
});

describe("SearchModal", () => {
  it("is reachable by an accessible name and searches on typing", async () => {
    vi.mocked(api.search).mockResolvedValue({ channels: [], members: [], messages: [] });
    render(<SearchModal onClose={vi.fn()} onSelectChannel={vi.fn()} onViewProfile={vi.fn()} />);
    const input = screen.getByLabelText("Search Vocal");
    await userEvent.setup().type(input, "hello");
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("hello"));
  });

  it("closes when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<SearchModal onClose={onClose} onSelectChannel={vi.fn()} onViewProfile={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close search" }));
    expect(onClose).toHaveBeenCalled();
  });
});
