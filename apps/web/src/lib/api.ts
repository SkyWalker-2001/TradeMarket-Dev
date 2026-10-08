export type SessionUser = { id: string; email: string; name: string; role: 'member' | 'admin' };
export type AuthResponse = { token: string; user: SessionUser };

const TOKEN_KEY = 'trade-market-token';
const USER_KEY = 'trade-market-user';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export function getAuthToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try { const raw = window.localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) as SessionUser : null; }
  catch { return null; }
}

export function saveSession(auth: AuthResponse) {
  window.localStorage.setItem(TOKEN_KEY, auth.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
  window.dispatchEvent(new Event('trade-market-auth'));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event('trade-market-auth'));
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Request failed');
  return payload as T;
}
