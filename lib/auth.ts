/**
 * Better Auth Client for Frontend
 *
 * Replaces lib/supabase.ts for authentication.
 * Install better-auth in the root package: npm i better-auth
 */

import { createAuthClient } from "better-auth/react";

// The auth service runs on port 3001 as a sidecar
const AUTH_URL = import.meta.env.VITE_AUTH_URL || "http://localhost:3001";

export const authClient = createAuthClient({
  baseURL: AUTH_URL,
});

// Convenience exports
export const {
  signIn,
  signUp,
  signOut,
  useSession,
} = authClient;

/**
 * Get the current session token for API calls.
 * Used to pass auth to the FastAPI backend.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = await authClient.getSession();
  if (session?.data?.session?.token) {
    return {
      Authorization: `Bearer ${session.data.session.token}`,
    };
  }
  return {};
}
