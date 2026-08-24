import { useEffect } from "react";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./auth/AuthGate";
import { DesktopGate } from "./desktop/DesktopGate";
import { ErrorBoundary } from "./ErrorBoundary";
import { MainLayout } from "./layout/MainLayout";
import { ToastProvider } from "./toast/ToastContext";
import { applyServerDefaultAccent } from "./theme/accent";

export function App() {
  useEffect(() => {
    void applyServerDefaultAccent();
  }, []);

  return (
    <ToastProvider>
      <DesktopGate>
        <AuthProvider>
          <ErrorBoundary>
            <AuthGate>{(user) => <MainLayout currentUser={user} />}</AuthGate>
          </ErrorBoundary>
        </AuthProvider>
      </DesktopGate>
    </ToastProvider>
  );
}
