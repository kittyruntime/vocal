import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("is reachable by its label and reflects the checked state", () => {
    render(<Checkbox label="Moderate" checked={true} onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "Moderate" })).toBeChecked();
  });

  it("calls onChange with the toggled value on click", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Moderate" checked={false} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Moderate" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("accepts compound ReactNode content as the label", () => {
    render(
      <Checkbox
        label={<><i data-testid="dot" style={{ background: "#ff0000" }} />Moderators</>}
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("dot")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Moderators" })).toBeInTheDocument();
  });
});
