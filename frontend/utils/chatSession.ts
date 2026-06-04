const CHAT_SESSION_STORAGE_KEY = "science-gpt.chat_session_id";

let inMemoryChatSessionId: string | null = null;

function getCryptoApi(): Crypto | undefined {
  if (typeof globalThis === "undefined") return undefined;
  return globalThis.crypto;
}

function getSessionStorage(): Storage | null {
  if (typeof globalThis === "undefined" || !("sessionStorage" in globalThis)) {
    return null;
  }

  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function readStoredChatSessionId(): string | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  try {
    return storage.getItem(CHAT_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredChatSessionId(sessionId: string): void {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(CHAT_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Ignore blocked sessionStorage and fall back to in-memory IDs.
  }
}

export function createChatSessionId(): string {
  const cryptoApi = getCryptoApi();
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    const randomHex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return `chat-${randomHex}`;
  }

  throw new Error("Secure random ID generation is unavailable.");
}

export function getOrCreateChatSessionId(): string {
  const existing = readStoredChatSessionId() ?? inMemoryChatSessionId;
  if (existing) return existing;

  const next = createChatSessionId();
  inMemoryChatSessionId = next;
  writeStoredChatSessionId(next);
  return next;
}

export function resetChatSessionId(): string {
  const next = createChatSessionId();
  inMemoryChatSessionId = next;
  writeStoredChatSessionId(next);
  return next;
}
