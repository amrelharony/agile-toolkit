"use client";

import { Component, type ReactNode } from "react";

interface Props {
  /** Human-readable name shown in dev when the boundary catches. */
  name: string;
  /** Custom fallback UI; defaults to a minimal recovery card. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary for the AppShell. Catches render-time exceptions
 * in any descendant (providers, sidebar, header, route content) and shows a
 * minimal recovery UI with a "Try again" button that clears the boundary
 * state. Without this, a single render throw in an optional provider
 * (auth, sync) would white-out the whole app.
 *
 * Async errors (rejected promises in effects) bypass error boundaries — those
 * still need explicit try/catch in the offending code.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error(`[${this.props.name}] caught error:`, error, info.componentStack);
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div
          role="alert"
          className="min-h-screen flex items-center justify-center p-6 bg-bg text-text"
        >
          <div className="max-w-md text-center space-y-3">
            <h1 className="text-xl font-display font-bold">Something went wrong</h1>
            <p className="text-sm text-sub">
              The page hit an unexpected error. Your data is saved locally;
              nothing was lost.
            </p>
            <pre className="text-[11px] text-sub bg-[var(--card)] border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono text-left">
              {this.state.error.message || String(this.state.error)}
            </pre>
            <button
              type="button"
              onClick={this.reset}
              className="px-4 py-2 rounded-md bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 text-sm font-medium"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
