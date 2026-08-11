import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

describe("Select", () => {
  it("is reachable by its label and reports the selected option", async () => {
    const onChange = vi.fn();
    render(
      <Select label="Expires" value="24" onChange={onChange}>
        <option value="1">1 hour</option>
        <option value="24">1 day</option>
      </Select>,
    );
    const select = screen.getByLabelText("Expires");
    expect(select).toHaveValue("24");
    await userEvent.setup().selectOptions(select, "1");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows an inline error", () => {
    render(
      <Select label="Access" value="" onChange={() => {}} error="Choose an access level">
        <option value="">Select…</option>
      </Select>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Choose an access level");
  });
});
