/**
 * Authentication Utilities (Better Auth)
 *
 * Drop-in replacement for the old Supabase auth utilities.
 * All public exports have the same names and signatures so that
 * the 16+ consumer components/hooks don't need changes.
 *
 * Better Auth stores session state server-side (cookie-based).
 * The auth sidecar runs on VITE_AUTH_URL (default http://localhost:3001).
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export interface Session {
  token: string;
  userId: string;
  expiresAt: Date;
}

interface BetterAuthSession {
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
  };
}

// Auth requests go through the Vite proxy (/api/auth/* → localhost:3001)
// so we use same-origin (empty string) by default.
const AUTH_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_AUTH_URL) ||
  "";

// ─── Internal helpers ───────────────────────────────────────────────────────

let _cachedSession: BetterAuthSession | null = null;
let _sessionFetchPromise: Promise<BetterAuthSession | null> | null = null;

/**
 * Fetch the current session from the Better Auth sidecar.
 * Deduplicates concurrent calls.
 */
async function _fetchSession(): Promise<BetterAuthSession | null> {
  if (_sessionFetchPromise) return _sessionFetchPromise;

  _sessionFetchPromise = (async () => {
    try {
      const res = await fetch(`${AUTH_URL}/api/auth/get-session`, {
        credentials: "include",
      });
      if (!res.ok) {
        _cachedSession = null;
        return null;
      }
      const data = await res.json();
      if (data?.session && data?.user) {
        _cachedSession = data;
        return data;
      }
      _cachedSession = null;
      return null;
    } catch (err) {
      console.warn("[Auth] Failed to fetch session:", err);
      _cachedSession = null;
      return null;
    } finally {
      _sessionFetchPromise = null;
    }
  })();

  return _sessionFetchPromise;
}

// ─── Public API (same names as old Supabase version) ────────────────────────

/**
 * Get the current session
 */
export async function getSession(): Promise<Session | null> {
  const data = await _fetchSession();
  if (!data?.session) return null;
  return {
    token: data.session.token,
    userId: data.session.userId,
    expiresAt: new Date(data.session.expiresAt),
  };
}

/**
 * Get valid access token from current session.
 * Returns the Better Auth session token for API calls.
 */
export async function getValidToken(): Promise<string | null> {
  const data = await _fetchSession();
  if (!data?.session?.token) {
    console.log("[Auth] No valid session token available");
    return null;
  }

  // Check expiration with 30s buffer
  const expiresAt = new Date(data.session.expiresAt).getTime();
  const now = Date.now();
  if (now > expiresAt - 30_000) {
    console.log("[Auth] Token expiring soon, re-fetching session...");
    _cachedSession = null;
    const refreshed = await _fetchSession();
    return refreshed?.session?.token ?? null;
  }

  return data.session.token;
}

/**
 * Synchronous version - gets token from cache if available.
 * Use this for initial render checks, but prefer async version for API calls.
 */
export function getValidTokenSync(): string | null {
  if (!_cachedSession?.session?.token) return null;

  const expiresAt = new Date(_cachedSession.session.expiresAt).getTime();
  const GRACE_MS = 60_000; // 60s grace window
  if (Date.now() > expiresAt + GRACE_MS) {
    return null;
  }
  return _cachedSession.session.token;
}

/**
 * Check if token/session is expired
 */
export async function isTokenExpired(): Promise<boolean> {
  const session = await getSession();
  if (!session) return true;
  return Date.now() > session.expiresAt.getTime();
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<void> {
  try {
    await fetch(`${AUTH_URL}/api/auth/sign-out`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.warn("[Auth] Sign out request failed:", err);
  }
  _cachedSession = null;
}

/**
 * Sign in with GitHub (Enterprise Cloud uses standard github.com OAuth)
 */
export async function signInWithGitHub(): Promise<{ error: Error | null }> {
  try {
    // Better Auth social sign-in: POST to the sign-in endpoint
    const callbackUrl = `${window.location.origin}/auth/callback`;
    const res = await fetch(`${AUTH_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        provider: "github",
        callbackURL: callbackUrl,
      }),
    });

    const data = await res.json();

    // Better Auth returns a redirect URL for OAuth providers
    if (data?.url) {
      window.location.href = data.url;
      return { error: null };
    }

    // If there's a redirect in the response
    if (data?.redirect) {
      window.location.href = data.redirect;
      return { error: null };
    }

    return { error: new Error(data?.message || "Failed to initiate GitHub sign-in") };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * @deprecated Keep for backward compat — alias for signInWithGitHub
 */
export const signInWithMicrosoft = signInWithGitHub;

/**
 * @deprecated — Avoid using this. It signs the user out and reloads.
 * Only kept for backward compatibility.
 */
export function clearTokenAndReload(): void {
  signOut().then(() => {
    window.location.reload();
  });
}

/**
 * Enhanced fetch wrapper that handles authentication automatically.
 *
 * IMPORTANT: This function will NEVER call clearTokenAndReload().
 * If authentication fails, it throws an error so the calling code can
 * decide how to handle it.
 *
 * On 401:
 *   1. Refreshes the session (re-fetches from auth sidecar)
 *   2. Retries the request once with the fresh token
 *   3. If retry also 401s, throws — but does NOT sign out
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let token = await getValidToken();

  if (!token) {
    throw new Error("No valid session — please refresh or log in again");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  // Attach session ID header if applicable
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

  const response = await fetch(url, { ...options, headers });

  // Handle 401 — try ONE refresh + retry
  if (response.status === 401) {
    console.warn(`[Auth] 401 on ${url} — re-fetching session and retrying...`);

    _cachedSession = null;
    const refreshed = await _fetchSession();
    const newToken = refreshed?.session?.token;

    if (!newToken) {
      console.error("[Auth] Session refresh failed after 401.");
      throw new Error(
        "Authentication failed — session expired. Please log in again."
      );
    }

    headers.set("Authorization", `Bearer ${newToken}`);
    const retryResponse = await fetch(url, { ...options, headers });

    if (retryResponse.status === 401) {
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
    const apiUrl =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL;
    if (apiUrl) {
      await authenticatedFetch(`${apiUrl}/auth/history`, { method: "POST" });
      console.log("Login event recorded successfully");
    }
  } catch (error) {
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
  if (!session?.expiresAt) return null;

  const timeLeftMs = session.expiresAt.getTime() - Date.now();
  return timeLeftMs > 0 ? Math.floor(timeLeftMs / 1000) : 0;
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
  const data = await _fetchSession();
  if (!data?.user) return null;

  return {
    id: data.user.id,
    email: data.user.email,
    name: data.user.name,
    avatar: data.user.image || undefined,
  };
}

// ─── Proactive refresh on visibility change ─────────────────────────────────

let _visibilityListenerInstalled = false;

/**
 * Install a visibility listener that refreshes the session when the tab
 * becomes visible. Safe to call multiple times — only installs once.
 */
export function installVisibilityRefreshListener(): void {
  if (_visibilityListenerInstalled) return;
  _visibilityListenerInstalled = true;

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;

    // Tab just became visible — invalidate cache and re-fetch
    _cachedSession = null;
    const data = await _fetchSession();
    if (data) {
      console.log("[Auth] ✅ Session refreshed on tab visibility");
    } else {
      console.warn("[Auth] ⚠️ No session on tab visibility — user may need to re-login");
    }
  });

  console.log("[Auth] Visibility-based session refresh listener installed");
}
