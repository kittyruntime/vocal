import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("is reachable by its label and reflects the controlled value", async () => {
    const onChange = vi.fn();
    render(<Textarea label="About me" value="Hello" onChange={onChange} />);
    const textarea = screen.getByLabelText("About me");
    expect(textarea).toHaveValue("Hello");
    await userEvent.setup().type(textarea, "!");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows a hint", () => {
    render(<Textarea label="About me" value="" onChange={() => {}} hint="190 characters max" />);
    expect(screen.getByText("190 characters max")).toBeInTheDocument();
  });

  it("wires aria-describedby and aria-invalid to an error message", () => {
    render(<Textarea label="About me" value="" onChange={() => {}} error="Too long" />);
    const textarea = screen.getByLabelText("About me");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
  });

  it("wires aria-describedby to the hint message", () => {
    render(<Textarea label="About me" value="" onChange={() => {}} hint="190 characters max" />);
    const textarea = screen.getByLabelText("About me");
    const hint = screen.getByText("190 characters max");
    expect(hint.id).not.toBe("");
    expect(textarea).toHaveAttribute("aria-describedby", hint.id);
  });

  it("forwards arbitrary textarea props", () => {
    render(<Textarea label="About me" value="" onChange={() => {}} maxLength={190} rows={4} />);
    const textarea = screen.getByLabelText("About me");
    expect(textarea).toHaveAttribute("maxlength", "190");
    expect(textarea).toHaveAttribute("rows", "4");
  });
});
