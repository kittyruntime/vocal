import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./auth/AuthGate";
import { MainLayout } from "./layout/MainLayout";
import { ToastProvider } from "./toast/ToastContext";

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AuthGate>{(user) => <MainLayout currentUser={user} />}</AuthGate>
      </AuthProvider>
    </ToastProvider>
  );
}
