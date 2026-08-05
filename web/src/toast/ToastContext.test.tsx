import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./ToastContext";

function Trigger({ message }: { message: string }) {
  const { showToast } = useToast();
  return <button onClick={() => showToast(message)}>fire</button>;
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("ToastProvider", () => {
  it("shows a toast and auto-dismisses it after 5s", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ToastProvider>
        <Trigger message="Oups" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Oups")).toBeInTheDocument();
    vi.advanceTimersByTime(5000);
    await waitFor(() => expect(screen.queryByText("Oups")).not.toBeInTheDocument());
  });

  it("throws when useToast is used outside a provider", () => {
    const Bare = () => {
      useToast();
      return null;
    };
    expect(() => render(<Bare />)).toThrow("useToast must be used within a ToastProvider");
  });
});
