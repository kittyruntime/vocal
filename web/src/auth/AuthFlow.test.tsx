import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "./AuthContext";
import { AuthGate } from "./AuthGate";
import * as api from "../api/client";
import { ApiError } from "../api/client";

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
  };
});

function renderGate() {
  render(
    <AuthProvider>
      <AuthGate>{(user) => <div>Contenu protégé pour {user.username}</div>}</AuthGate>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getSetupStatus).mockReset();
  vi.mocked(api.getMe).mockReset();
  vi.mocked(api.setup).mockReset();
  vi.mocked(api.login).mockReset();
  vi.mocked(api.register).mockReset();
  window.history.replaceState({}, "", "/");
});

describe("AuthGate", () => {
  it("shows the setup screen when no admin exists yet", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: false });
    renderGate();
    expect(await screen.findByText("Bienvenue sur Vocal")).toBeInTheDocument();
  });

  it("creates the admin account and unlocks the app", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: false });
    vi.mocked(api.setup).mockResolvedValue({ ok: true });
    renderGate();
    await screen.findByText("Bienvenue sur Vocal");
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockResolvedValue({ id: "1", username: "theo", role: "admin" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nom d'utilisateur"), "theo");
    await user.type(screen.getByLabelText("Mot de passe"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Créer le compte admin" }));
    expect(await screen.findByText("Contenu protégé pour theo")).toBeInTheDocument();
    expect(api.setup).toHaveBeenCalledWith("theo", "correct horse battery");
  });

  it("shows the login screen when setup is done but the user is signed out", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, "authentication required"));
    renderGate();
    expect(await screen.findByText("Connexion")).toBeInTheDocument();
  });

  it("shows an inline error when login fails", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, "authentication required"));
    vi.mocked(api.login).mockRejectedValue(new ApiError(401, "invalid credentials"));
    renderGate();
    await screen.findByText("Connexion");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nom d'utilisateur"), "theo");
    await user.type(screen.getByLabelText("Mot de passe"), "wrong");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid credentials");
  });

  it("shows the register screen when an invite token is present in the URL", async () => {
    window.history.replaceState({}, "", "/?invite=abc123");
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, "authentication required"));
    renderGate();
    expect(await screen.findByText("Rejoindre Vocal")).toBeInTheDocument();
  });

  it("renders protected content once signed in", async () => {
    vi.mocked(api.getSetupStatus).mockResolvedValue({ done: true });
    vi.mocked(api.getMe).mockResolvedValue({ id: "1", username: "theo", role: "admin" });
    renderGate();
    expect(await screen.findByText("Contenu protégé pour theo")).toBeInTheDocument();
  });
});
