import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    fetch("/api/server/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        url: window.location.href,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold">Something went wrong</h2>
            <p className="text-muted-foreground text-sm max-w-sm">
              An unexpected error occurred. The error has been reported
              automatically.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Refresh page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
