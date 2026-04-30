import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';

function formatDate(dt) {
  return new Date(dt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function ResultChips({ results }) {
  const available = results.filter(r => r.available === true);
  const taken     = results.filter(r => r.available === false);
  return (
    <div className="history-results">
      {available.slice(0, 6).map(r => (
        <span key={r.tld} className="result-chip available">.{r.tld}</span>
      ))}
      {taken.slice(0, 4).map(r => (
        <span key={r.tld} className="result-chip taken">.{r.tld}</span>
      ))}
      {results.length > 10 && (
        <span className="result-chip more">+{results.length - 10} more</span>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const [items,   setItems]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [expanded, setExpanded] = useState(null);

  const LIMIT = 20;

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/api/history?page=${page}&limit=${LIMIT}`);
      setItems(data.items);
      setTotal(data.total);
    } catch {
      setError('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  async function handleDelete(id) {
    try {
      await api.delete(`/api/history/${id}`);
      setItems(prev => prev.filter(i => i.id !== id));
      setTotal(t => t - 1);
    } catch { /* ignore */ }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="history-container">
      <div className="history-header">
        <h1>Search History</h1>
        {total > 0 && <span className="history-count">{total} searches</span>}
      </div>

      {loading && (
        <div className="loading-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton-card" style={{ height: 72, marginBottom: 12, animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>
      )}

      {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

      {!loading && items.length === 0 && (
        <div className="empty-state">
          <div className="icon">📋</div>
          <h3>No searches yet</h3>
          <p>Your domain searches will appear here after you sign in and search.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 20, display: 'inline-block' }}>
            Start searching
          </Link>
        </div>
      )}

      <div className="history-list">
        {items.map(item => {
          const results  = Array.isArray(item.results) ? item.results : JSON.parse(item.results || '[]');
          const avail    = results.filter(r => r.available === true).length;
          const isOpen   = expanded === item.id;

          return (
            <div key={item.id} className={`history-item ${isOpen ? 'open' : ''}`}>
              <div className="history-item-header" onClick={() => setExpanded(isOpen ? null : item.id)}>
                <div>
                  <span className="history-query">{item.query}.*</span>
                  <div className="history-meta">
                    <span className="category-tag">{item.category}</span>
                    · {formatDate(item.searched_at)}
                    · <span className="avail-count">{avail} available</span>
                  </div>
                </div>
                <div className="history-item-actions">
                  <span className="expand-icon">{isOpen ? '▲' : '▼'}</span>
                  <button
                    className="delete-btn"
                    onClick={e => { e.stopPropagation(); handleDelete(item.id); }}
                    aria-label="Delete"
                  >
                    🗑
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="history-detail">
                  <ResultChips results={results} />
                  <div className="history-full-results">
                    {results.map(r => (
                      <div key={r.tld} className={`mini-result ${r.status}`}>
                        <span className="mini-domain">{r.domain}</span>
                        <span className={`status-badge ${r.status}`}>
                          {r.available === true ? '✓ Available' : r.available === false ? '✗ Taken' : '? Unknown'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
            ← Prev
          </button>
          <span className="page-info">Page {page} of {totalPages}</span>
          <button className="btn btn-ghost" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
