import { useEffect } from "react";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./auth/AuthGate";
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
      <AuthProvider>
        <ErrorBoundary>
          <AuthGate>{(user) => <MainLayout currentUser={user} />}</AuthGate>
        </ErrorBoundary>
      </AuthProvider>
    </ToastProvider>
  );
}
