import { HomeOSClient } from '@homeos/shared';

/** All browser requests go through the same-origin /api proxy (see next.config.mjs). */
export const API_BASE = '/api/v1';

let signedOutHandler: (() => void) | null = null;

export function onSignedOut(handler: () => void): void {
  signedOutHandler = handler;
}

/**
 * Single client for the whole app. The access token lives in memory only; the refresh
 * token is an httpOnly cookie that JavaScript cannot read.
 */
export const api = new HomeOSClient({
  baseUrl: API_BASE,
  credentials: 'include',
  onSignedOut: () => signedOutHandler?.(),
});

/** Turn an API-relative path such as "/files/<token>" into a browser URL. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return 'Something went wrong';
}
