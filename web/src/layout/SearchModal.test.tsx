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

  it("renders the search input inside a form-field wrapper directly under .search-input", () => {
    const { container } = render(
      <SearchModal onClose={vi.fn()} onSelectChannel={vi.fn()} onViewProfile={vi.fn()} />
    );

    const searchInput = container.querySelector(".search-input");
    const formField = container.querySelector(".search-input > .form-field");
    const input = container.querySelector(".search-input input");
    const label = container.querySelector(".search-input .sr-only");

    // Verify elements exist with correct structure
    expect(searchInput).toBeTruthy();
    expect(formField).toBeTruthy();
    expect(input).toBeTruthy();
    expect(label).toBeTruthy();

    // The .search-input > .form-field CSS selector (index.css) depends on this exact nesting
    expect(formField!.parentElement?.className).toContain("search-input");

    // Verify input has form-input class and is inside form-field
    expect(input!.className).toContain("form-input");
    expect(input!.parentElement?.className).toContain("form-field");

    // Verify label is sr-only (visually hidden but accessible)
    expect(label!.className).toContain("sr-only");

    // Verify input still has the search-modal-specific attributes
    expect(input!.getAttribute("placeholder")).toBe("Search messages, files, channels and members");
  });
});
