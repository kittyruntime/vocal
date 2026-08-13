import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextField } from "./TextField";

describe("TextField", () => {
  it("is reachable by its label and reflects the controlled value", async () => {
    const onChange = vi.fn();
    render(<TextField label="Username" value="theo" onChange={onChange} />);
    const input = screen.getByLabelText("Username");
    expect(input).toHaveValue("theo");
    await userEvent.setup().type(input, "!");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows an inline error", () => {
    render(<TextField label="Username" value="" onChange={() => {}} error="Username is required" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Username is required");
  });

  it("wires aria-describedby and aria-invalid to the error message", () => {
    render(<TextField label="Username" value="" onChange={() => {}} error="Username is required" />);
    const input = screen.getByLabelText("Username");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
  });

  it("wires aria-describedby to the hint message", () => {
    render(<TextField label="Username" value="" onChange={() => {}} hint="2-32 characters" />);
    const input = screen.getByLabelText("Username");
    const hint = screen.getByText("2-32 characters");
    expect(hint.id).not.toBe("");
    expect(input).toHaveAttribute("aria-describedby", hint.id);
  });

  it("does not set aria-invalid when there is no error", () => {
    render(<TextField label="Username" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Username")).not.toHaveAttribute("aria-invalid");
  });

  it("forwards arbitrary input props", () => {
    render(<TextField label="Password" type="password" value="" onChange={() => {}} required maxLength={256} />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("maxlength", "256");
  });

  it("renders an optional prefix without changing the input's accessible name", () => {
    render(<TextField label="Channel name" value="general" onChange={() => {}} prefix="#" />);
    expect(screen.getByText("#")).toBeInTheDocument();
    expect(screen.getByLabelText("Channel name")).toHaveValue("general");
  });

  it("forwards a ref to the underlying input element", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<TextField ref={ref} label="Username" value="theo" onChange={() => {}} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByLabelText("Username"));
  });
});
