import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorField } from "./ColorField";

describe("ColorField", () => {
  it("is reachable by its label and reflects the value", () => {
    render(<ColorField label="Role color" value="#5865f2" onChange={() => {}} />);
    expect(screen.getByLabelText("Role color")).toHaveValue("#5865f2");
  });

  it("calls onChange with the new hex value", () => {
    const onChange = vi.fn();
    render(<ColorField label="Role color" value="#5865f2" onChange={onChange} />);
    const input = screen.getByLabelText("Role color");
    fireEvent.change(input, { target: { value: "#ff0000" } });
    expect(onChange).toHaveBeenCalledWith("#ff0000");
  });
});
