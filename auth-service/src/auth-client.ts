/**
 * Better Auth Client Configuration
 *
 * This file is imported by the frontend (React/Vite).
 * It replaces the Supabase auth client in lib/supabase.ts.
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_AUTH_URL || "http://localhost:3001",
});

// Export convenience hooks and methods
export const {
  signIn,
  signUp,
  signOut,
  useSession,
} = authClient;
