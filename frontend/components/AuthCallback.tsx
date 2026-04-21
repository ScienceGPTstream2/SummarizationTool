/**
 * Auth Callback Component
 *
 * Handles the OAuth callback from Better Auth / Microsoft Entra.
 * Better Auth sets session cookies server-side, so we just need to
 * verify a session exists and redirect to the main app.
 */

import { useEffect, useState } from "react";
import { getSession } from "../utils/authUtils";

interface AuthCallbackProps {
  onSuccess: () => void;
  onError: (error: string) => void;
}

export function AuthCallback({ onSuccess, onError }: AuthCallbackProps) {
  const [status, setStatus] = useState<"processing" | "success" | "error">(
    "processing"
  );
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Better Auth handles the OAuth code exchange server-side and
        // sets a session cookie. We just check if a session exists.
        const session = await getSession();

        if (session) {
          console.log("Auth successful, session established");
          setStatus("success");

          // Record login history (async, don't block UI)
          import("../utils/authUtils").then(({ recordLoginEvent }) => {
            recordLoginEvent();
          });

          // Small delay to show success state
          setTimeout(() => {
            onSuccess();
          }, 500);
        } else {
          // No session yet — wait a moment and retry (cookie might not be set yet)
          setTimeout(async () => {
            const retrySession = await getSession();

            if (retrySession) {
              setStatus("success");
              onSuccess();
            } else {
              const urlError = new URLSearchParams(window.location.search).get("error");
              const msg = urlError
                ? "Your account is not authorized to access this application. Contact your administrator."
                : "Authentication failed. Please try again.";
              setErrorMessage(msg);
              setStatus("error");
              onError(msg);
            }
          }, 1500);
        }
      } catch (err) {
        console.error("Auth callback exception:", err);
        const msg = err instanceof Error ? err.message : "An unexpected error occurred";
        setErrorMessage(msg);
        setStatus("error");
        onError(msg);
      }
    };

    handleAuthCallback();
  }, [onSuccess, onError]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="text-center space-y-6">
        {status === "processing" && (
          <>
            <div className="mx-auto w-16 h-16 relative">
              <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Completing sign in...</h2>
              <p className="text-muted-foreground">
                Please wait while we verify your authentication.
              </p>
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-green-600">
                Sign in successful!
              </h2>
              <p className="text-muted-foreground">Redirecting you now...</p>
            </div>
          </>
        )}

        {status === "error" && (
          <>
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-red-600">
                Sign in failed
              </h2>
              <p className="text-muted-foreground">
                {errorMessage || "There was a problem signing you in."}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
