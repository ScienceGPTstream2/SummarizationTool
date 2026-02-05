export function getSessionId(): string {
  const existing = sessionStorage.getItem("session_id");
  if (existing) {
    return existing;
  }

  const newId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem("session_id", newId);
  return newId;
}

export function shouldAttachSessionHeader(url: string): boolean {
  if (url.startsWith("/api")) {
    return true;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    return (
      parsed.origin === window.location.origin &&
      parsed.pathname.startsWith("/api")
    );
  } catch {
    return false;
  }
}
