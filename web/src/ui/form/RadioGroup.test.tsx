import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioGroup } from "./RadioGroup";

const options = [
  { value: "text" as const, label: "Text", description: "Send messages" },
  { value: "voice" as const, label: "Voice", description: "Talk live" },
];

describe("RadioGroup", () => {
  it("renders a radiogroup with the current value checked", () => {
    render(<RadioGroup label="Channel type" options={options} value="text" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Channel type" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Text/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Voice/ })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange when an option is clicked", async () => {
    const onChange = vi.fn();
    render(<RadioGroup label="Channel type" options={options} value="text" onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("radio", { name: /Voice/ }));
    expect(onChange).toHaveBeenCalledWith("voice");
  });

  it("only the checked option is tabbable (roving tabindex)", () => {
    render(<RadioGroup label="Channel type" options={options} value="text" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /Text/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /Voice/ })).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowRight moves selection to the next option and wraps around", async () => {
    const onChange = vi.fn();
    render(<RadioGroup label="Channel type" options={options} value="voice" onChange={onChange} />);
    screen.getByRole("radio", { name: /Voice/ }).focus();
    await userEvent.setup().keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("text");
  });

  it("ArrowLeft moves selection to the previous option and wraps around", async () => {
    const onChange = vi.fn();
    render(<RadioGroup label="Channel type" options={options} value="text" onChange={onChange} />);
    screen.getByRole("radio", { name: /Text/ }).focus();
    await userEvent.setup().keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenCalledWith("voice");
  });

  it("renders an optional icon without changing the option's accessible name", () => {
    const withIcons = [
      { value: "text" as const, label: "Text", description: "Send messages", icon: <svg data-testid="text-icon" /> },
      { value: "voice" as const, label: "Voice", description: "Talk live" },
    ];
    render(<RadioGroup label="Channel type" options={withIcons} value="text" onChange={() => {}} />);
    expect(screen.getByTestId("text-icon")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Text/ })).toBeInTheDocument();
  });
});
