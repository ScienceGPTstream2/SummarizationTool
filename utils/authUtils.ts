/**
 * Authentication Utilities (Supabase)
 *
 * Provides centralized authentication management using Supabase.
 * Key design decisions:
 *   - NEVER nuke app state on transient auth failures (no clearTokenAndReload
 *     inside authenticatedFetch). Background API calls hitting a 401 should NOT
 *     destroy the user's in-progress work.
 *   - Deduplicate concurrent refresh attempts so multiple components don't
 *     race each other.
 *   - Proactively refresh on tab-visibility change (Chrome throttles timers in
 *     backgrounded tabs, so Supabase's autoRefreshToken may not fire in time).
 */

import { supabase, Session } from "../lib/supabase";

// ─── Refresh deduplication ──────────────────────────────────────────────────
// If a refresh is already in flight, all callers share the same promise so we
// don't fire 5+ concurrent refreshSession() calls from different components.
let _refreshPromise: Promise<Session | null> | null = null;

async function _doRefresh(): Promise<Session | null> {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      console.warn("[Auth] Session refresh failed:", error.message);
      return null;
    }
    return data.session;
  } finally {
    // Clear the singleton so the next caller starts a fresh refresh
    _refreshPromise = null;
  }
}

function deduplicatedRefresh(): Promise<Session | null> {
  if (!_refreshPromise) {
    _refreshPromise = _doRefresh();
  }
  return _refreshPromise;
}

// ─── Public API ─────────────────────────────────────────────────────────────

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
 * Get valid access token from current session.
 *
 * 1. Tries the cached session first.
 * 2. If expired or missing, performs a deduplicated refresh.
 * 3. Returns null on failure — callers decide how to handle it
 *    (toast, retry, etc.) instead of blowing up the app.
 */
export async function getValidToken(): Promise<string | null> {
  let session = await getSession();

  // Check if we have a token and it's not about to expire (30s buffer)
  if (session?.access_token && session.expires_at) {
    const nowSecs = Math.floor(Date.now() / 1000);
    const bufferSecs = 30; // refresh 30s before actual expiry
    if (nowSecs < session.expires_at - bufferSecs) {
      return session.access_token;
    }
    // Token is expired or about to expire — fall through to refresh
    console.log("[Auth] Token expiring soon, proactively refreshing...");
  }

  // No valid token — attempt refresh (deduplicated)
  if (!session?.access_token || !session) {
    console.log("[Auth] No access token, attempting session refresh...");
  }

  session = await deduplicatedRefresh();
  return session?.access_token ?? null;
}

/**
 * Synchronous version - gets token from memory/storage if available.
 * Use this for initial render checks, but prefer async version for API calls.
 *
 * Includes a 60-second grace period so that a token that *just* expired
 * doesn't immediately flash the user to the login screen before the async
 * refresh has a chance to run.
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

    // Allow a 60-second grace window so the async refresh can complete
    // before we declare the user "logged out" from a sync check.
    const GRACE_SECONDS = 60;
    if (expiresAt && Date.now() / 1000 > expiresAt + GRACE_SECONDS) {
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
 * @deprecated — Avoid using this. It signs the user out and reloads,
 * destroying all in-memory state. Prefer throwing an error and letting
 * the UI handle it gracefully (e.g. show a "session expired" toast).
 *
 * Only kept for backward compatibility in places where a hard reset is
 * truly the last resort (e.g. user explicitly clicks "Sign out").
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
 * Enhanced fetch wrapper that handles authentication automatically.
 *
 * IMPORTANT: This function will NEVER call clearTokenAndReload().
 * If authentication fails, it throws an error so the calling code can
 * decide how to handle it (show a toast, retry, etc.) without
 * destroying the user's in-progress work.
 *
 * On 401:
 *   1. Refreshes the token (deduplicated)
 *   2. Retries the request once with the fresh token
 *   3. If retry also 401s, throws — but does NOT sign out
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Get token from session
  let token = await getValidToken();

  if (!token) {
    // No valid session — throw but do NOT nuke state.
    // The UI will handle this (e.g. show a "please log in" banner).
    throw new Error("No valid session — please refresh or log in again");
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

  // Handle 401 Unauthorized — try ONE refresh + retry before giving up
  if (response.status === 401) {
    console.warn(
      `[Auth] 401 on ${url} — attempting token refresh and retry...`
    );

    // Force a fresh refresh (not from cache)
    const refreshedSession = await deduplicatedRefresh();
    const newToken = refreshedSession?.access_token;

    if (!newToken) {
      // Refresh failed — session is truly gone, but still don't nuke state.
      // The user's work is still in memory; they can copy it or try again.
      console.error(
        "[Auth] Token refresh failed after 401. Session may be expired."
      );
      throw new Error(
        "Authentication failed — session expired. Please log in again."
      );
    }

    // Retry original request with fresh token
    headers.set("Authorization", `Bearer ${newToken}`);
    const retryResponse = await fetch(url, { ...options, headers });

    if (retryResponse.status === 401) {
      // Even after refresh, still 401 — something is really wrong
      console.error("[Auth] Retry with fresh token still returned 401.");
      throw new Error(
        "Authentication failed after token refresh. Please log in again."
      );
    }

    return retryResponse;
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

// ─── Proactive refresh on visibility change ─────────────────────────────────
// Chrome (and other browsers) aggressively throttle timers in backgrounded
// tabs. Supabase's `autoRefreshToken` relies on setTimeout, so it may not
// fire in time when the user comes back after 5+ minutes. This listener
// ensures we refresh immediately when the tab regains focus.

let _visibilityListenerInstalled = false;

/**
 * Install a one-time `visibilitychange` listener that proactively refreshes
 * the Supabase session when the tab becomes visible again.
 *
 * Safe to call multiple times — only installs once.
 */
export function installVisibilityRefreshListener(): void {
  if (_visibilityListenerInstalled) return;
  _visibilityListenerInstalled = true;

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;

    // Tab just became visible — check if token needs refresh
    const session = await getSession();
    if (!session) return; // Not logged in, nothing to do

    const nowSecs = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at ?? 0;
    const timeLeft = expiresAt - nowSecs;

    // If token expired or expires within 5 minutes, proactively refresh
    if (timeLeft < 300) {
      console.log(
        `[Auth] Tab visible, token ${timeLeft <= 0 ? "expired" : `expires in ${timeLeft}s`} — refreshing...`
      );
      const refreshed = await deduplicatedRefresh();
      if (refreshed) {
        console.log("[Auth] ✅ Proactive token refresh succeeded");
      } else {
        console.warn(
          "[Auth] ⚠️ Proactive refresh failed — user may need to re-login"
        );
      }
    }
  });

  console.log("[Auth] Visibility-based token refresh listener installed");
}
