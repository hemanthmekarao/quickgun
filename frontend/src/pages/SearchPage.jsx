import { useState } from 'react';
import { useDomainSearch } from '../hooks/useDomainSearch';
import DomainCard from '../components/DomainCard';
import AiSuggest from '../components/AiSuggest';

const CATEGORIES = [
  { key: 'popular',  label: 'Popular' },
  { key: 'business', label: 'Business' },
  { key: 'tech',     label: 'Technology' },
  { key: 'country',  label: 'Country' },
  { key: 'new',      label: 'New gTLDs' },
  { key: 'all',      label: 'All TLDs' },
];

export default function SearchPage() {
  const [input,    setInput]    = useState('');
  const [category, setCategory] = useState('popular');
  const [sortBy,   setSortBy]   = useState('status');

  const { results, isSearching, isDone } = useDomainSearch(input, category);

  // Sort: available → auction → taken → unknown
  const sorted = [...results].sort((a, b) => {
    if (sortBy === 'status') {
      const score = { available: 0, auction: 1, taken: 2 };
      const sa = score[a.status] ?? 3;
      const sb = score[b.status] ?? 3;
      return sa !== sb ? sa - sb : a.tld.localeCompare(b.tld);
    }
    return a.tld.localeCompare(b.tld);
  });

  const availableCount = results.filter(r => r.status === 'available').length;
  const auctionCount   = results.filter(r => r.status === 'auction').length;
  const showResults    = input.trim().length >= 2;

  // When AiSuggest picks a name, populate the search input
  function handleAiSearch(name) {
    setInput(name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="search-page">

      {/* ── Hero ───────────────────────────────────────────── */}
      <div className="hero">
        <div className="hero-eyebrow">
          <span className="hero-eyebrow-dot" />
          Live availability · 1500+ TLDs
        </div>

        <h1>Find Your Perfect Domain</h1>
        <p className="hero-sub">
          Results stream in the moment you type — no button needed.
        </p>

        <div className="search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="Type a domain name…"
            value={input}
            onChange={e => setInput(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          {input && (
            <button className="clear-btn" onClick={() => setInput('')} aria-label="Clear">✕</button>
          )}
        </div>

        {/* Status pill */}
        <div className="search-status">
          {isSearching && (
            <span className="status-checking">
              <span className="pulse-dot" />
              Checking {results.length > 0 ? `${results.length} checked so far…` : 'availability…'}
            </span>
          )}
          {isDone && results.length > 0 && (
            <span className="status-done">
              {availableCount > 0
                ? `✓ ${availableCount} available${auctionCount > 0 ? ` · ${auctionCount} at auction` : ''}`
                : auctionCount > 0
                  ? `${auctionCount} available at auction`
                  : 'No available domains in this category'}
            </span>
          )}
        </div>
      </div>

      {/* ── Category tabs ──────────────────────────────────── */}
      <div className="tabs-row">
        <div className="category-tabs">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              className={`tab ${category === cat.key ? 'active' : ''}`}
              onClick={() => setCategory(cat.key)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {results.length > 0 && (
          <div className="sort-controls">
            <span className="sort-label">Sort:</span>
            <button className={`sort-btn ${sortBy === 'status' ? 'active' : ''}`} onClick={() => setSortBy('status')}>
              Available first
            </button>
            <button className={`sort-btn ${sortBy === 'alpha' ? 'active' : ''}`} onClick={() => setSortBy('alpha')}>
              A–Z
            </button>
          </div>
        )}
      </div>

      {/* ── Results ────────────────────────────────────────── */}
      <div className="results-container">

        {showResults && results.length === 0 && isSearching && (
          <div className="skeleton-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 0.07}s` }} />
            ))}
          </div>
        )}

        {sorted.length > 0 && (
          <div className="results-grid">
            {sorted.map(r => (
              <DomainCard
                key={r.tld}
                domain={r.domain}
                tld={r.tld}
                available={r.available}
                status={r.status}
              />
            ))}
          </div>
        )}

        {/* ── Legend ─────────────────────────────────────── */}
        {sorted.length > 0 && (
          <div className="results-legend">
            <span className="legend-item available">● Available — register now</span>
            <span className="legend-item auction">● Auction — acquirable on aftermarket</span>
            <span className="legend-item taken">● Taken — not available</span>
          </div>
        )}

        {/* ── AI Suggestion panel ─────────────────────────── */}
        {showResults && (
          <AiSuggest originalDomain={input.trim()} onSearch={handleAiSearch} />
        )}

        {/* ── Landing hints (no query) ─────────────────────── */}
        {!showResults && (
          <div className="landing-hints">
            <div className="hint-grid">
              {[
                { icon: '⚡', title: 'Instant streaming', desc: 'Results arrive as each TLD is checked in parallel.' },
                { icon: '🌍', title: '1500+ TLDs', desc: 'Every TLD from .com to the latest ccTLDs and gTLDs.' },
                { icon: '💸', title: 'Best commission first', desc: 'Register links go to the highest-paying affiliate first.' },
                { icon: '🤖', title: 'AI name ideas', desc: 'Claude suggests personalized names based on your profile.' },
              ].map(h => (
                <div key={h.title} className="hint-card">
                  <span className="hint-icon">{h.icon}</span>
                  <strong>{h.title}</strong>
                  <p>{h.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
