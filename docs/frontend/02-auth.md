# Authentication

> *Before a reviewer can use the tool they need to prove who they are. Science-GPT uses GitHub OAuth — the reviewer clicks "Sign in with GitHub", gets redirected to GitHub, approves access, and is sent back to the app with a session token. This document covers the login page, the OAuth callback handler, and `authUtils.ts` — the utility module that attaches auth tokens to every API call the app makes.*

## 1. Components

| File | Purpose |
|---|---|
| `components/LoginPage.tsx` | GitHub login UI |
| `components/AuthCallback.tsx` | Handles the redirect back from GitHub |
| `utils/authUtils.ts` | Session management, token refresh, authenticated fetch |

---

## 2. LoginPage

**File:** `components/LoginPage.tsx` (~192 lines)

### What the user sees

A split-screen layout:

- **Left (60%)** — hero section with the headline "Complexity, solved. Focus, restored.", animated `AuroraText`, and three stat callouts (10× faster, 98% accuracy, 500+ documents processed).
- **Right (40%)** — login form with a single "Sign in with GitHub" button, a loading spinner during auth, and an error message if the flow fails.

### What happens on click

```
User clicks "Sign in with GitHub"
  │
  ▼
signInWithGitHub()                        ← authUtils.ts
  │
  ▼
POST /api/auth/sign-in/social             ← Better Auth sidecar
  │
  ▼
Redirect to github.com/login/oauth/authorize
```

The browser leaves the app entirely. GitHub handles the credential check, then redirects back to the app's callback URL.

### State

| State | Type | Purpose |
|---|---|---|
| `isLoading` | `boolean` | Shows spinner while auth is in flight |
| `error` | `string \| null` | Displays error message if GitHub rejects or network fails |

---

## 3. AuthCallback

**File:** `components/AuthCallback.tsx` (~151 lines)

This component renders briefly after GitHub redirects the browser back to the app. It never shows meaningful UI — it processes the OAuth result and then navigates away.

### What happens

```
Browser lands on /auth/callback?code=...
  │
  ▼
AuthCallback mounts
  │
  ▼
Better Auth sidecar exchanges code for session
  │
  ▼
Session cookie set by sidecar response
  │
  ▼
App.tsx detects valid session → navigate to "upload"
  │
  ▼ (on failure)
Toast notification shown → redirect back to "login"
```

The `code` query parameter from GitHub is handled server-side by the Better Auth sidecar — `AuthCallback.tsx` does not parse it directly. Its job is to wait for the sidecar to finish and then let `App.tsx`'s session check take over.

---

## 4. `authUtils.ts`

**File:** `utils/authUtils.ts`

This is the most important auth file in the frontend. Every single API call in the app goes through `authenticatedFetch()`, which lives here.

### Key functions

#### `getSession()`

```typescript
async function getSession(): Promise<Session | null>
```

Fetches the current session from the Better Auth sidecar at `GET /api/auth/get-session`. Caches the result in `_cachedSession` to avoid redundant network calls on rapid re-renders.

**Deduplication:** If `getSession()` is called concurrently (e.g., two components mount at the same time), all calls share the same in-flight promise and receive the same result. This prevents a burst of session requests on app load.

#### `getValidToken()`

```typescript
async function getValidToken(): Promise<string>
```

Returns the current bearer token. If the token expires within 30 seconds, it refreshes the session first before returning. This ensures tokens passed to API calls are never about to expire mid-request.

#### `authenticatedFetch()`

```typescript
async function authenticatedFetch(url: string, options?: RequestInit): Promise<Response>
```

A drop-in replacement for `fetch()` that automatically:

1. Calls `getValidToken()` to get a fresh bearer token.
2. Adds `Authorization: Bearer {token}` to the request headers.
3. Adds `X-Session-Id: {sessionId}` if a session ID is available (used for cost tracking on the backend).
4. If the response is `401`, refreshes the session and retries the request **once**.
5. If the retry also returns `401`, throws an auth error (does not loop).

All API calls across every page component use `authenticatedFetch()` — not raw `fetch()`.

#### `installVisibilityRefreshListener()`

```typescript
function installVisibilityRefreshListener(): void
```

Registers a `visibilitychange` event listener on `document`. When the browser tab becomes visible again (after being hidden), this immediately calls `getSession()` to refresh the cached token.

**Why this exists:** Chrome aggressively throttles background tabs. A reviewer who leaves the app open in a background tab for 30+ minutes may return to find their session token expired. Without this listener, the next API call would fail with 401 and show an error. With it, the token is silently refreshed the moment they switch back to the tab.

`App.tsx` calls `installVisibilityRefreshListener()` once on mount.

#### `signInWithGitHub()`

Initiates the OAuth flow. Calls the Better Auth client to redirect the browser to GitHub's authorization URL.

#### `signOut()`

Posts to `POST /api/auth/sign-out`, which invalidates the server-side session. Clears `_cachedSession` locally, then reloads the page to land on the login screen.

#### `getCurrentUser()`

Returns `{ id, email, name, image }` from the cached session. Used by App.tsx to display the user's name and avatar in the navigation bar.

---

## 5. Session token lifecycle

```
App loads
  │
  ▼
getSession() → cache result in _cachedSession
  │
  ├── No session → navigate to "login"
  │
  └── Valid session
        │
        ▼
      App renders
        │
        ▼
      User makes API call
        │
        ▼
      authenticatedFetch()
        │
        ├── Token still valid → attach header → send request
        │
        └── Token expires within 30s → getValidToken() refreshes first → attach header → send
              │
              └── Response 401 → refresh session → retry once
                    │
                    └── Still 401 → throw AuthError → user redirected to login
```

---

## 6. Security notes

- Tokens are stored in `HttpOnly` cookies by the Better Auth sidecar — JavaScript cannot read them directly. The frontend only handles the bearer token returned from `getSession()`, which is a short-lived JWT.
- `authenticatedFetch()` never logs tokens.
- The visibility refresh listener only refreshes the session cache — it does not store credentials anywhere.
- `signOut()` always invalidates the server-side session, not just the local cache. A reviewer logging out on one device/tab invalidates the session for all.
