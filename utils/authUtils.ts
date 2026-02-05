/**
 * Authentication Utilities (Supabase)
 *
 * Provides centralized authentication management using Supabase.
 * Replaces the previous custom JWT-based authentication.
 */

import { supabase, Session } from "../lib/supabase";

/**
 * Get the current session
 */
export async function getSession(): Promise<Session | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Get valid access token from current session
 * Will attempt to refresh the session if no token is available
 */
export async function getValidToken(): Promise<string | null> {
  let session = await getSession();

  // If no session or token is missing, try to refresh
  if (!session?.access_token) {
    console.log("[Auth] No access token, attempting session refresh...");
    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      console.warn("[Auth] Session refresh failed:", error.message);
      return null;
    }
    session = data.session;
  }

  return session?.access_token ?? null;
}

/**
 * Synchronous version - gets token from memory/storage if available
 * Use this for initial render checks, but prefer async version for API calls
 */
export function getValidTokenSync(): string | null {
  // Supabase stores session in localStorage with key format: sb-{project-ref}-auth-token
  const keys = Object.keys(localStorage);
  const supabaseKey = keys.find(
    (key) => key.startsWith("sb-") && key.endsWith("-auth-token")
  );

  if (!supabaseKey) return null;

  try {
    const stored = localStorage.getItem(supabaseKey);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    const accessToken = parsed?.access_token;
    const expiresAt = parsed?.expires_at;

    if (!accessToken) return null;

    // Check if expired
    if (expiresAt && Date.now() / 1000 > expiresAt) {
      return null;
    }

    return accessToken;
  } catch {
    return null;
  }
}

/**
 * Check if token/session is expired
 */
export async function isTokenExpired(): Promise<boolean> {
  const session = await getSession();
  if (!session) return true;

  const expiresAt = session.expires_at;
  if (!expiresAt) return true;

  // expires_at is in seconds
  return Date.now() / 1000 > expiresAt;
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Clear session and reload page (for error recovery)
 */
export function clearTokenAndReload(): void {
  supabase.auth.signOut().then(() => {
    window.location.reload();
  });
}

/**
 * Sign in with GitHub OAuth
 */
export async function signInWithGitHub(): Promise<{ error: Error | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: {
        prompt: "select_account",
      },
    },
  });
  return { error };
}

/**
 * Enhanced fetch wrapper that handles authentication automatically
 *
 * - Gets token from Supabase session
 * - Automatically handles 401 responses
 * - Clears expired sessions and forces re-login
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Get token from session
  const token = await getValidToken();

  if (!token) {
    // No valid session, force re-login
    clearTokenAndReload();
    throw new Error("No valid session");
  }

  // Add authorization header
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  try {
    const { getSessionId, shouldAttachSessionHeader } = await import(
      "./session"
    );
    if (shouldAttachSessionHeader(url)) {
      headers.set("X-Session-Id", getSessionId());
    }
  } catch (error) {
    console.warn("Failed to attach session header:", error);
  }

  // Make the request
  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized (expired or invalid token)
  if (response.status === 401) {
    console.warn("Received 401 Unauthorized, session is invalid or expired");
    clearTokenAndReload();
    throw new Error("Authentication failed");
  }

  return response;
}

/**
 * Record a login event in the history
 */
export async function recordLoginEvent(): Promise<void> {
  try {
    if (import.meta.env.VITE_API_URL) {
      const apiUrl = import.meta.env.VITE_API_URL;
      await authenticatedFetch(`${apiUrl}/auth/history`, {
        method: "POST",
      });
      console.log("Login event recorded successfully");
    } else {
      console.warn("VITE_API_URL not defined, skipping login recording");
    }
  } catch (error) {
    // Silently fail - analytics should not block user flow
    console.error("Failed to record login event:", error);
  }
}

/**
 * Check if user is authenticated (has valid session)
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session !== null;
}

/**
 * Synchronous version for initial render checks
 */
export function isAuthenticatedSync(): boolean {
  return getValidTokenSync() !== null;
}

/**
 * Get time until session expires (in seconds), or null if no valid session
 */
export async function getTokenTimeToExpiry(): Promise<number | null> {
  const session = await getSession();
  if (!session?.expires_at) return null;

  const now = Math.floor(Date.now() / 1000);
  const timeLeft = session.expires_at - now;
  return timeLeft > 0 ? timeLeft : 0;
}

/**
 * Get current user info from session
 */
export async function getCurrentUser(): Promise<{
  id: string;
  email: string | undefined;
  name: string | undefined;
  avatar: string | undefined;
} | null> {
  const session = await getSession();
  if (!session?.user) return null;

  const user = session.user;
  const metadata = user.user_metadata || {};

  return {
    id: user.id,
    email: user.email,
    name: metadata.full_name || metadata.name || metadata.user_name,
    avatar: metadata.avatar_url,
  };
}
