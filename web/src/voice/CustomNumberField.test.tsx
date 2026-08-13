import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CustomNumberField } from "./CustomNumberField";

describe("CustomNumberField", () => {
  it("commits a valid draft immediately", () => {
    const onCommit = vi.fn();
    render(<CustomNumberField label="Webcam bitrate (kb/s)" value={1700} min={100} max={20000} step={100} onCommit={onCommit} />);
    const input = screen.getByRole("spinbutton", { name: "Webcam bitrate (kb/s)" });
    fireEvent.change(input, { target: { value: "2400" } });
    expect(onCommit).toHaveBeenCalledWith(2400);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("shows an accessible error without committing an invalid draft", () => {
    const onCommit = vi.fn();
    render(<CustomNumberField label="Frame rate (fps)" value={30} min={5} max={60} step={1} onCommit={onCommit} />);
    const input = screen.getByRole("spinbutton", { name: "Frame rate (fps)" });
    fireEvent.change(input, { target: { value: "90" } });
    expect(screen.getByText("Frame rate (fps) must be between 5 and 60.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("clamps a finite out-of-range draft on blur", () => {
    const onCommit = vi.fn();
    render(<CustomNumberField label="Frame rate (fps)" value={30} min={5} max={60} step={1} onCommit={onCommit} />);
    const input = screen.getByRole("spinbutton", { name: "Frame rate (fps)" });
    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(60);
    expect(input).toHaveValue(60);
    expect(screen.queryByText(/must be between/)).not.toBeInTheDocument();
  });

  it("restores the last valid value when an empty draft blurs", () => {
    const onCommit = vi.fn();
    render(<CustomNumberField label="Width (px)" value={1280} min={320} max={3840} step={1} onCommit={onCommit} />);
    const input = screen.getByRole("spinbutton", { name: "Width (px)" });
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(input);
    expect(input).toHaveValue(1280);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
