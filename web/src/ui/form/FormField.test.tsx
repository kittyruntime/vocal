import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("associates the label with the control via htmlFor/id", () => {
    render(
      <FormField label="Username" htmlFor="the-id">
        <input id="the-id" />
      </FormField>,
    );
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
  });

  it("shows an error message with role=alert when error is set", () => {
    render(
      <FormField label="Username" htmlFor="the-id" error="Username is required">
        <input id="the-id" />
      </FormField>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Username is required");
  });

  it("shows a hint when there is no error", () => {
    render(
      <FormField label="Username" htmlFor="the-id" hint="2-32 characters">
        <input id="the-id" />
      </FormField>,
    );
    expect(screen.getByText("2-32 characters")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides the hint once an error is present", () => {
    render(
      <FormField label="Username" htmlFor="the-id" hint="2-32 characters" error="Too short">
        <input id="the-id" />
      </FormField>,
    );
    expect(screen.queryByText("2-32 characters")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Too short");
  });

  it("gives the error message a stable id derived from htmlFor, for aria-describedby wiring", () => {
    render(
      <FormField label="Username" htmlFor="the-id" error="Username is required">
        <input id="the-id" />
      </FormField>,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("id", "the-id-message");
  });

  it("gives the hint the same stable id pattern when there is no error", () => {
    render(
      <FormField label="Username" htmlFor="the-id" hint="2-32 characters">
        <input id="the-id" />
      </FormField>,
    );
    expect(screen.getByText("2-32 characters")).toHaveAttribute("id", "the-id-message");
  });

  it("visually hides the label without removing it from the accessibility tree", () => {
    render(
      <FormField label="Search Vocal" htmlFor="the-id" visuallyHiddenLabel>
        <input id="the-id" />
      </FormField>,
    );
    const label = screen.getByText("Search Vocal");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveClass("sr-only");
  });
});
