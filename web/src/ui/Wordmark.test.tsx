import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Wordmark } from "./Wordmark";

describe("Wordmark", () => {
  it("renders the Vocal wordmark as plain readable text", () => {
    const { container } = render(<Wordmark />);
    // The accent letter lives in its own inline <span>, so the text is split
    // across DOM nodes; toHaveTextContent reads the full concatenated text
    // (what a screen reader announces), unlike getByText which only matches
    // a single node's direct text.
    expect(container).toHaveTextContent("VOCAL");
  });
});
