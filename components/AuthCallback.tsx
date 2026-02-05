/**
 * Auth Callback Component
 *
 * Handles the OAuth callback from Supabase/GitHub.
 * This component is displayed while processing the authentication response.
 */

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface AuthCallbackProps {
  onSuccess: () => void;
  onError: (error: string) => void;
}

export function AuthCallback({ onSuccess, onError }: AuthCallbackProps) {
  const [status, setStatus] = useState<"processing" | "success" | "error">(
    "processing"
  );

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Supabase automatically handles the code exchange when detectSessionInUrl is true
        // We just need to check if we have a valid session
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error("Auth callback error:", error);
          setStatus("error");
          onError(error.message);
          return;
        }

        if (session) {
          console.log("Auth successful, user:", session.user.email);
          setStatus("success");

          // Record login history (async, don't await blocking the UI)
          import("../utils/authUtils").then(({ recordLoginEvent }) => {
            recordLoginEvent();
          });

          // Small delay to show success state
          setTimeout(() => {
            onSuccess();
          }, 500);
        } else {
          // No session and no error - might be during code exchange
          // Wait a bit and check again
          setTimeout(async () => {
            const {
              data: { session: retrySession },
              error: retryError,
            } = await supabase.auth.getSession();

            if (retryError) {
              setStatus("error");
              onError(retryError.message);
            } else if (retrySession) {
              setStatus("success");
              onSuccess();
            } else {
              setStatus("error");
              onError("Authentication failed. Please try again.");
            }
          }, 1000);
        }
      } catch (err) {
        console.error("Auth callback exception:", err);
        setStatus("error");
        onError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
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
                There was a problem signing you in.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
