/**
 * Authentication Utilities
 *
 * Provides centralized token management and automatic handling of expired tokens
 */

/**
 * Decode JWT token without verification (client-side only)
 */
function decodeJWT(token: string): any {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error("Failed to decode JWT:", error);
    return null;
  }
}

/**
 * Check if token is expired
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return true; // Invalid token or no expiration = treat as expired
  }

  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  return decoded.exp < now;
}

/**
 * Get valid token from localStorage, or null if expired/invalid
 */
export function getValidToken(): string | null {
  const token = localStorage.getItem("token");
  if (!token) {
    return null;
  }

  if (isTokenExpired(token)) {
    console.warn("Token has expired, clearing from storage");
    localStorage.removeItem("token");
    return null;
  }

  return token;
}

/**
 * Clear token and trigger re-login
 */
export function clearTokenAndReload() {
  localStorage.removeItem("token");
  // Reload the page to trigger the login screen
  window.location.reload();
}

/**
 * Enhanced fetch wrapper that handles authentication automatically
 *
 * - Checks token expiration before making request
 * - Automatically handles 401 responses
 * - Clears expired tokens and forces re-login
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Check if we have a valid token
  const token = getValidToken();

  if (!token) {
    // Token is expired or missing, force re-login
    clearTokenAndReload();
    throw new Error("Token expired or missing");
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
    console.warn("Received 401 Unauthorized, token is invalid or expired");
    clearTokenAndReload();
    throw new Error("Authentication failed");
  }

  return response;
}

/**
 * Check if user is authenticated (has valid token)
 */
export function isAuthenticated(): boolean {
  return getValidToken() !== null;
}

/**
 * Get time until token expires (in seconds), or null if no valid token
 */
export function getTokenTimeToExpiry(): number | null {
  const token = localStorage.getItem("token");
  if (!token) {
    return null;
  }

  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const timeLeft = decoded.exp - now;
  return timeLeft > 0 ? timeLeft : 0;
}
