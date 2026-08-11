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

  it("forwards arbitrary input props", () => {
    render(<TextField label="Password" type="password" value="" onChange={() => {}} required maxLength={256} />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("maxlength", "256");
  });
});
