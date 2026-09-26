// Stores the JWT in localStorage. Every access is guarded because storage can be
// unavailable (private mode, blocked site data) and the app must still work.
const KEY = "dsrmt.token";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // session lasts until reload
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
