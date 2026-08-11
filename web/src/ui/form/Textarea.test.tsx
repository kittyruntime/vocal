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

  it("forwards arbitrary textarea props", () => {
    render(<Textarea label="About me" value="" onChange={() => {}} maxLength={190} rows={4} />);
    const textarea = screen.getByLabelText("About me");
    expect(textarea).toHaveAttribute("maxlength", "190");
    expect(textarea).toHaveAttribute("rows", "4");
  });
});
