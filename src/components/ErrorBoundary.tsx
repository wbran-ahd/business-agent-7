/**
 * Per-feature error boundary.
 *
 * The app only had a root boundary, so a crash inside (say) the chart canvas
 * wiped the whole screen. Each feature can now fail in isolation and the rest
 * of the ledger keeps working.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Shown in place of the crashed section. */
  fallback: ReactNode;
  /** Used to scope the console warning. */
  scope?: string;
};

type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || "Unexpected error" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[sauti-baqaya:${this.props.scope ?? "app"}] section crashed`, {
      reason: error.message,
      stack: info.componentStack?.slice(0, 400),
    });
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
