import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean };

// React requires class components for error boundaries (no hook equivalent exists yet for
// componentDidCatch/getDerivedStateFromError). Keeps one bad WebSocket/reducer frame from
// blanking the whole page.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled error in the app tree", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen" role="alert">
          Une erreur est survenue. Recharge la page.
        </div>
      );
    }
    return this.props.children;
  }
}
