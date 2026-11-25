'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { can, type Action, type ModuleKey, type PermissionMap } from '@homeos/shared';
import { api, onSignedOut } from './api';

export interface HouseholdSummary {
  id: string;
  name: string;
  currency: string;
  memberId: string;
  roleKey: string;
  roleName: string;
  permissions: PermissionMap;
  propertyScope: string[];
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  mfaEnabled: boolean;
}

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in';
  user: SessionUser | null;
  households: HouseholdSummary[];
  household: HouseholdSummary | null;
  currency: string;
  can: (module: ModuleKey, action?: Action) => boolean;
  signIn: (data: { user: SessionUser; households: HouseholdSummary[] }) => void;
  signOut: () => Promise<void>;
  switchHousehold: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
const HOUSEHOLD_KEY = 'homeos.household';

function pickHousehold(list: HouseholdSummary[]): HouseholdSummary | null {
  if (list.length === 0) return null;
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(HOUSEHOLD_KEY);
  } catch {
    saved = null;
  }
  return list.find((h) => h.id === saved) ?? list[0];
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (count, err: any) => count < 1 && !(err?.status >= 400 && err?.status < 500) },
        },
      }),
  );
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [households, setHouseholds] = useState<HouseholdSummary[]>([]);
  const [household, setHousehold] = useState<HouseholdSummary | null>(null);

  const apply = useCallback((data: { user: SessionUser; households: HouseholdSummary[] }) => {
    const chosen = pickHousehold(data.households);
    api.setHousehold(chosen?.id ?? null);
    setUser(data.user);
    setHouseholds(data.households);
    setHousehold(chosen);
    setStatus('signed-in');
  }, []);

  const clear = useCallback(() => {
    api.setAccessToken(null);
    api.setHousehold(null);
    setUser(null);
    setHouseholds([]);
    setHousehold(null);
    setStatus('signed-out');
    queryClient.clear();
  }, [queryClient]);

  const reload = useCallback(async () => {
    const me = await api.get('/auth/me');
    apply(me);
  }, [apply]);

  // On first load, try to resume the session from the httpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false;
    onSignedOut(() => clear());
    (async () => {
      const ok = await api.refresh();
      if (cancelled) return;
      if (!ok) {
        setStatus('signed-out');
        return;
      }
      try {
        const me = await api.get('/auth/me');
        if (!cancelled) apply(me);
      } catch {
        if (!cancelled) setStatus('signed-out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, clear]);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      status,
      user,
      households,
      household,
      currency: household?.currency ?? 'INR',
      can: (module, action = 'read') => can(household?.permissions, module, action),
      signIn: apply,
      signOut: async () => {
        try {
          await api.logout();
        } catch {
          /* the local session is cleared regardless */
        }
        clear();
      },
      switchHousehold: (id) => {
        const next = households.find((h) => h.id === id);
        if (!next) return;
        try {
          window.localStorage.setItem(HOUSEHOLD_KEY, id);
        } catch {
          /* ignore */
        }
        api.setHousehold(id);
        setHousehold(next);
        queryClient.clear();
      },
      reload,
    }),
    [status, user, households, household, apply, clear, queryClient, reload],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </QueryClientProvider>
  );
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <Providers>');
  return v;
}
