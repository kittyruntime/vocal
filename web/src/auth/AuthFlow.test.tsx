import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import { AuthGate } from "./AuthGate";
import * as api from "../api/client";
import { ApiError, ACCENT_PRESETS } from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    getSetupStatus: vi.fn(),
    getMe: vi.fn(),
    setup: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getAppearance: vi.fn(),
  };
});

function renderGate() {
  render(
    <AuthProvider>
      <AuthGate>{(user) => <div>Protected content for {user.username}</div>}</AuthGate>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getSetupStatus).mockReset();
  vi.mocked(api.getMe).mockReset();
  vi.mocked(api.setup).mockReset();
  vi.mocked(api.login).mockReset();
  vi.mocked(api.register).mockReset();
  vi.mocked(api.getAppearance).mockReset();
  delete document.documentElement.dataset.accent;
  window.history.replaceState({}, "", "/");
});

describe("AuthGate", () => {
  it("shows the setup screen when no admin exists yet", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: false });
    renderGate();
    expect(await screen.findByText("Welcome to Vocal")).toBeInTheDocument();
  });

  it("creates the admin account and unlocks the app", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: false });
    vi.mocked(api.setup).mockResolvedValue({ ok: true });
    renderGate();
    await screen.findByText("Welcome to Vocal");
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockResolvedValue({ id: "1", username: "theo", capabilities: ["manage_channels", "manage_server", "moderate", "publish_voice"] });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "theo");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create admin account" }));
    expect(await screen.findByText("Protected content for theo")).toBeInTheDocument();
    expect(api.setup).toHaveBeenCalledWith("theo", "correct horse battery");
  });

  it("shows the login screen when setup is done but the user is signed out", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, "authentication required"));
    renderGate();
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("allows a signed-out visitor to open public registration", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, "authentication required"));
    renderGate();
    await screen.findByRole("heading", { name: "Log in" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Create an account" }));
    expect(await screen.findByText("Join Vocal")).toBeInTheDocument();
  });

  it("shows an inline error when login fails", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, "authentication required"));
    vi.mocked(api.login).mockRejectedValue(new ApiError(401, "invalid credentials"));
    renderGate();
    await screen.findByRole("heading", { name: "Log in" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "theo");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid credentials");
  });

  it("shows the register screen when an invite token is present in the URL", async () => {
    window.history.replaceState({}, "", "/?invite=abc123");
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, "authentication required"));
    renderGate();
    expect(await screen.findByText("Join Vocal")).toBeInTheDocument();
  });

  it("renders protected content once signed in", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockResolvedValue({ id: "1", username: "theo", capabilities: ["manage_channels", "manage_server", "moderate", "publish_voice"] });
    renderGate();
    expect(await screen.findByText("Protected content for theo")).toBeInTheDocument();
  });

  it("shows a retry screen when the initial bootstrap call fails, and can recover", async () => {
    vi.mocked(api.getSetupStatus).mockRejectedValueOnce(new ApiError(503, "service unavailable"));
    renderGate();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("service unavailable")).toBeInTheDocument();

    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Welcome to Vocal")).toBeInTheDocument();
  });

  it("shows a generic message on retry screen for a non-ApiError failure", async () => {
    vi.mocked(api.getSetupStatus).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderGate();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText(/server/i)).toBeInTheDocument();
  });

  it("clears the invite token from the URL after a successful registration", async () => {
    window.history.replaceState({}, "", "/?invite=abc123");
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, "authentication required"));
    vi.mocked(api.register).mockResolvedValue({ ok: true });
    renderGate();
    await screen.findByText("Join Vocal");

    vi.mocked(api.getMe).mockResolvedValue({ id: "1", username: "theo", capabilities: [] });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "theo");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create my account" }));

    expect(await screen.findByText("Protected content for theo")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(api.register).toHaveBeenCalledWith("theo", "correct horse battery", "abc123");
  });
});

function SignOutButton() {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>Sign out</button>;
}

function PhaseAndSignOut() {
  const { state, signOut } = useAuth();
  return (
    <div>
      <span>{state.phase}</span>
      <button onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}

describe("sign out", () => {
  it("resets the accent to the server default", async () => {
    vi.mocked(api.getAppearance).mockResolvedValue({ enabledPresets: [...ACCENT_PRESETS], defaultPreset: "glacier" });
    vi.mocked(api.logout).mockResolvedValue({ ok: true });
    document.documentElement.dataset.accent = "emerald";
    render(
      <AuthProvider>
        <SignOutButton />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("glacier"));
  });

  it("still completes sign out even if resetting the accent fails", async () => {
    vi.mocked(api.getAppearance).mockRejectedValue(new Error("network down"));
    vi.mocked(api.logout).mockResolvedValue({ ok: true });
    render(
      <AuthProvider>
        <PhaseAndSignOut />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByText("signed-out")).toBeInTheDocument());
  });
});
