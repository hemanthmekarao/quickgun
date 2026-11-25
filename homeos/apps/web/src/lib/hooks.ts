'use client';

import { useEffect, useState } from 'react';

/**
 * Read query-string values once on mount. Used for simple deep links such as
 * /documents?upload=1 without making the whole page depend on useSearchParams.
 */
export function useQueryParams(): URLSearchParams | null {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    setParams(new URLSearchParams(window.location.search));
  }, []);
  return params;
}

/** Tab state that is kept in the URL (?tab=…) so links and reloads land on the same tab. */
export function useTab<T extends string>(initial: T, allowed: readonly T[]): [T, (t: T) => void] {
  const [tab, setTab] = useState<T>(initial);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as T | null;
    if (t && allowed.includes(t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = (t: T) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  };
  return [tab, change];
}
