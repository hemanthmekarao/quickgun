/**
 * Platform-agnostic HomeOS API client. Uses only `fetch`, so the same code runs in the web
 * app, in React Native (Expo) and in Node. Token persistence is injected by the host app:
 * the web app keeps the refresh token in an httpOnly cookie, a mobile app would use the
 * device keychain and pass the refresh token explicitly.
 */

export interface ApiErrorBody {
  statusCode: number;
  code?: string;
  message: string;
  issues?: { field: string; message: string }[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly issues?: { field: string; message: string }[];
  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.issues = body.issues;
  }
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type RecordData = Record<string, any> & { id: string; _refs?: Record<string, { id: string; label: string }> };

export interface ListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  from?: string;
  to?: string;
  [filter: string]: string | number | boolean | undefined;
}

export interface TokenPair {
  accessToken: string;
  /** Returned in the body for native clients; web clients rely on the httpOnly cookie. */
  refreshToken?: string;
}

export interface ClientOptions {
  /** e.g. "https://api.example.com/v1" or "/api/v1" behind the web proxy. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Send cookies (web). Native clients leave this off and supply `getRefreshToken`. */
  credentials?: 'include' | 'omit' | 'same-origin';
  getRefreshToken?: () => Promise<string | null> | string | null;
  onTokens?: (tokens: TokenPair | null) => void | Promise<void>;
  /** Called when the session can no longer be refreshed. */
  onSignedOut?: () => void;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export class HomeOSClient {
  private accessToken: string | null = null;
  private householdId: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private readonly f: typeof fetch;

  constructor(private readonly opts: ClientOptions) {
    const impl = opts.fetch ?? (globalThis as any).fetch;
    if (!impl) throw new Error('No fetch implementation available');
    this.f = impl.bind(globalThis);
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }
  getAccessToken(): string | null {
    return this.accessToken;
  }
  setHousehold(id: string | null): void {
    this.householdId = id;
  }
  getHousehold(): string | null {
    return this.householdId;
  }

  url(path: string, query?: Query): string {
    let u = this.opts.baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
    if (query) {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
      if (parts.length) u += (u.includes('?') ? '&' : '?') + parts.join('&');
    }
    return u;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.accessToken) h.Authorization = `Bearer ${this.accessToken}`;
    if (this.householdId) h['X-Household-Id'] = this.householdId;
    return h;
  }

  /** Exchange the refresh token for a new access token. Concurrent callers share one request. */
  async refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const refreshToken = this.opts.getRefreshToken ? await this.opts.getRefreshToken() : null;
          const res = await this.f(this.url('/auth/refresh'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: this.opts.credentials,
            body: JSON.stringify(refreshToken ? { refreshToken } : {}),
          });
          if (!res.ok) {
            this.accessToken = null;
            await this.opts.onTokens?.(null);
            return false;
          }
          const tokens = (await res.json()) as TokenPair;
          this.accessToken = tokens.accessToken;
          await this.opts.onTokens?.(tokens);
          return true;
        } catch {
          return false;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  async raw(method: string, path: string, init: { query?: Query; body?: unknown; form?: any; retry?: boolean } = {}): Promise<Response> {
    const isForm = init.form !== undefined;
    const res = await this.f(this.url(path, init.query), {
      method,
      headers: this.headers(isForm || init.body === undefined ? undefined : { 'Content-Type': 'application/json' }),
      credentials: this.opts.credentials,
      body: isForm ? init.form : init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 401 && init.retry !== false && !path.startsWith('/auth/')) {
      if (await this.refresh()) return this.raw(method, path, { ...init, retry: false });
      this.opts.onSignedOut?.();
    }
    return res;
  }

  async request<T = any>(method: string, path: string, init: { query?: Query; body?: unknown; form?: any } = {}): Promise<T> {
    const res = await this.raw(method, path, init);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: any = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) throw new ApiError(res.status, typeof data === 'object' && data ? data : { message: String(data ?? '') });
    return data as T;
  }

  get<T = any>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }
  post<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body: body ?? {} });
  }
  patch<T = any>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }
  put<T = any>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body });
  }
  del<T = any>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
  /** Multipart upload. `form` is a FormData instance supplied by the platform. */
  upload<T = any>(path: string, form: any): Promise<T> {
    return this.request<T>('POST', path, { form });
  }

  /** CRUD helper for any registry resource, e.g. client.resource('vehicles').list(). */
  resource(key: string) {
    return {
      list: (query?: ListQuery) => this.get<Page<RecordData>>(`/${key}`, query),
      get: (id: string) => this.get<RecordData>(`/${key}/${id}`),
      create: (data: Record<string, unknown>) => this.post<RecordData>(`/${key}`, data),
      update: (id: string, data: Record<string, unknown>) => this.patch<RecordData>(`/${key}/${id}`, data),
      remove: (id: string) => this.del<void>(`/${key}/${id}`),
    };
  }

  /* ---- auth convenience ---- */

  async login(email: string, password: string, totp?: string): Promise<any> {
    const data = await this.request<any>('POST', '/auth/login', { body: { email, password, ...(totp ? { totp } : {}) } });
    this.accessToken = data.accessToken;
    await this.opts.onTokens?.(data);
    return data;
  }

  async register(input: { email: string; password: string; name: string; householdName?: string }): Promise<any> {
    const data = await this.request<any>('POST', '/auth/register', { body: input });
    this.accessToken = data.accessToken;
    await this.opts.onTokens?.(data);
    return data;
  }

  async logout(): Promise<void> {
    try {
      const refreshToken = this.opts.getRefreshToken ? await this.opts.getRefreshToken() : null;
      await this.request('POST', '/auth/logout', { body: refreshToken ? { refreshToken } : {} });
    } finally {
      this.accessToken = null;
      await this.opts.onTokens?.(null);
    }
  }
}
