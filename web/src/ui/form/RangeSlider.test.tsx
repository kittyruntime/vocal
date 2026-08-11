import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RangeSlider } from "./RangeSlider";

describe("RangeSlider", () => {
  it("is reachable by its label and calls onChange on every input tick without committing", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<RangeSlider label="Volume" value={50} min={0} max={100} onChange={onChange} onCommit={onCommit} />);
    const slider = screen.getByLabelText("Volume");
    fireEvent.change(slider, { target: { value: "80" } });
    expect(onChange).toHaveBeenCalledWith(80);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on pointer up", () => {
    const onCommit = vi.fn();
    render(<RangeSlider label="Volume" value={50} min={0} max={100} onChange={() => {}} onCommit={onCommit} />);
    const slider = screen.getByLabelText("Volume");
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalledWith(80);
  });

  it("commits on key up (keyboard adjustment never fires a pointer event)", () => {
    const onCommit = vi.fn();
    render(<RangeSlider label="Volume" value={50} min={0} max={100} onChange={() => {}} onCommit={onCommit} />);
    const slider = screen.getByLabelText("Volume");
    fireEvent.change(slider, { target: { value: "65" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledWith(65);
  });

  it("does not commit on a key that doesn't change the value (e.g. Tab)", () => {
    const onCommit = vi.fn();
    render(<RangeSlider label="Volume" value={50} min={0} max={100} onChange={() => {}} onCommit={onCommit} />);
    const slider = screen.getByLabelText("Volume");
    fireEvent.keyUp(slider, { key: "Tab" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("stays in sync with an externally-changed value prop, even without an intervening onChange", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <RangeSlider label="Volume" value={50} min={0} max={100} onChange={() => {}} onCommit={onCommit} />,
    );
    rerender(<RangeSlider label="Volume" value={80} min={0} max={100} onChange={() => {}} onCommit={onCommit} />);
    const slider = screen.getByLabelText("Volume");
    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalledWith(80);
  });
});
