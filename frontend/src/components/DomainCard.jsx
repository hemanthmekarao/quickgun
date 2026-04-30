import { useState } from 'react';
import { REGISTRARS, AUCTION_REGISTRARS } from '../config/registrars';

const STATUS_MAP = {
  available:    { cls: 'available', label: 'Available',    dot: '●' },
  auction:      { cls: 'auction',   label: 'At Auction',   dot: '●' },
  taken:        { cls: 'taken',     label: 'Taken',        dot: '●' },
  timeout:      { cls: 'unknown',   label: 'Timeout',      dot: '○' },
  rate_limited: { cls: 'unknown',   label: 'Limited',      dot: '○' },
  error:        { cls: 'unknown',   label: 'Error',        dot: '○' },
  invalid:      { cls: 'unknown',   label: 'Invalid',      dot: '○' },
  unknown:      { cls: 'unknown',   label: 'Unknown',      dot: '○' },
};

export default function DomainCard({ domain, tld, available, status }) {
  const [showMore, setShowMore] = useState(false);

  const dotIdx  = domain.indexOf('.');
  const base    = dotIdx !== -1 ? domain.slice(0, dotIdx) : domain;
  const ext     = dotIdx !== -1 ? domain.slice(dotIdx)    : '';
  const info    = STATUS_MAP[status] || STATUS_MAP.unknown;
  const primary = REGISTRARS[0];

  return (
    <div className={`domain-card ${info.cls}`}>
      <div className="card-accent" />

      <div className="card-body">
        <div className="card-top">
          <div className="domain-label">
            <span className="domain-base">{base}</span>
            <span className="domain-ext">{ext}</span>
          </div>
          <span className={`status-badge ${info.cls}`}>
            <span className="status-dot">{info.dot}</span>
            {info.label}
          </span>
        </div>

        {/* ── Available: register links ── */}
        {status === 'available' && (
          <div className="card-actions">
            <a
              href={primary.getUrl(domain)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-register"
            >
              <span className="btn-register-label">
                Register at {primary.name}
                {primary.badge && <span className="btn-register-badge">{primary.badge}</span>}
              </span>
              <span className="btn-register-arrow">→</span>
            </a>

            <button className="btn-more" onClick={() => setShowMore(v => !v)}>
              <span>{showMore ? '▲' : '▼'}</span>
              Compare {REGISTRARS.length - 1} more registrars
            </button>

            {showMore && (
              <div className="registrar-list">
                {REGISTRARS.slice(1).map(r => (
                  <a
                    key={r.id}
                    href={r.getUrl(domain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="registrar-row"
                  >
                    <span className="registrar-name">{r.name}</span>
                    {r.badge && <span className="registrar-badge">{r.badge}</span>}
                    <span className="registrar-arrow">→</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Auction: aftermarket links ── */}
        {status === 'auction' && (
          <div className="card-actions">
            <p className="auction-hint">This domain may be expiring — check auction marketplaces:</p>
            <div className="registrar-list" style={{ marginTop: 6 }}>
              {AUCTION_REGISTRARS.map(r => (
                <a
                  key={r.id}
                  href={r.getUrl(domain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="registrar-row"
                >
                  <span className="registrar-name">{r.name}</span>
                  <span className="registrar-badge">{r.badge}</span>
                  <span className="registrar-arrow">→</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
