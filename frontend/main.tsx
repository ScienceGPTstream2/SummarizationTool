import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./styles/globals.css";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";

function initObservability() {
  // Only enable in production or when explicitly opted in
  if (!import.meta.env.PROD && !import.meta.env.VITE_OTEL_ENABLED) return;
  try {
    import("@opentelemetry/sdk-trace-web").then(({ WebTracerProvider }) => {
      import("@opentelemetry/sdk-trace-base").then(({ BatchSpanProcessor }) => {
        import("@opentelemetry/exporter-trace-otlp-http").then(
          ({ OTLPTraceExporter }) => {
            import("@opentelemetry/instrumentation-fetch").then(
              ({ FetchInstrumentation }) => {
                import("@opentelemetry/instrumentation").then(
                  ({ registerInstrumentations }) => {
                    const exporter = new OTLPTraceExporter({
                      url: "/api/telemetry/traces",
                    });
                    const provider = new WebTracerProvider();
                    provider.addSpanProcessor(
                      new BatchSpanProcessor(exporter)
                    );
                    provider.register();
                    registerInstrumentations({
                      instrumentations: [new FetchInstrumentation()],
                    });
                  }
                );
              }
            );
          }
        );
      });
    });
  } catch {
    // Telemetry is non-critical — never block the app
  }
}

initObservability();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
