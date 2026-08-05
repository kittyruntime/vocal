import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./auth/AuthGate";
import { ErrorBoundary } from "./ErrorBoundary";
import { MainLayout } from "./layout/MainLayout";
import { ToastProvider } from "./toast/ToastContext";

export function App() {
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
