import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("reflects the checked state via role and aria-checked", () => {
    render(<Switch label="Public registration" checked={true} onChange={() => {}} />);
    const toggle = screen.getByRole("switch", { name: "Public registration" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the flipped value when clicked", async () => {
    const onChange = vi.fn();
    render(<Switch label="Public registration" checked={true} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("switch", { name: "Public registration" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("is a real button, so Space/Enter toggles it via native keyboard activation", async () => {
    const onChange = vi.fn();
    render(<Switch label="Public registration" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Public registration" });
    toggle.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles when the label text is clicked, via label/for association", async () => {
    const onChange = vi.fn();
    render(<Switch label="Public registration" checked={false} onChange={onChange} />);
    await userEvent.setup().click(screen.getByText("Public registration"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("hides the visible label when visuallyHiddenLabel is set, while remaining reachable by accessible name", () => {
    render(<Switch label="Screen sharing enabled" visuallyHiddenLabel checked={true} onChange={() => {}} />);
    const label = screen.getByText("Screen sharing enabled");
    expect(label.className).toContain("sr-only");
    expect(screen.getByRole("switch", { name: "Screen sharing enabled" })).toBeInTheDocument();
  });
});
