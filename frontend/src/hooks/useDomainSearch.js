import { useState, useEffect, useRef } from 'react';
import { useDebounce } from './useDebounce';

export function useDomainSearch(domain, category) {
  const [results,     setResults]     = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDone,      setIsDone]      = useState(false);
  const esRef = useRef(null);

  const debouncedDomain = useDebounce(domain.trim(), 400);

  useEffect(() => {
    // Close any existing stream
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const clean = debouncedDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('.')[0].toLowerCase();

    if (!clean || clean.length < 2) {
      setResults([]);
      setIsSearching(false);
      setIsDone(false);
      return;
    }

    setResults([]);
    setIsSearching(true);
    setIsDone(false);

    const token = localStorage.getItem('token') || '';
    const url   = `/api/search/stream?domain=${encodeURIComponent(clean)}&category=${encodeURIComponent(category)}&token=${token}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (ev) => {
      if (ev.data === '[DONE]') {
        setIsSearching(false);
        setIsDone(true);
        es.close();
        esRef.current = null;
        return;
      }
      try {
        const result = JSON.parse(ev.data);
        setResults(prev => [...prev, result]);
      } catch { /* malformed event — skip */ }
    };

    es.onerror = () => {
      setIsSearching(false);
      setIsDone(true);
      es.close();
      esRef.current = null;
    };

    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [debouncedDomain, category]);

  return { results, isSearching, isDone };
}
