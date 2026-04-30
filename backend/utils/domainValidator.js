function sanitizeDomain(input) {
  if (!input || typeof input !== 'string') return null;

  let domain = input.trim().toLowerCase();

  // Strip protocol and www
  domain = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

  // If user typed something like "acme.com" or "acme.co.uk", take first label only
  const firstLabel = domain.split('.')[0];
  if (!firstLabel) return null;

  // RFC 1035: labels must be 1-63 chars, alphanumeric and hyphens, not start/end with hyphen
  const valid = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(firstLabel) || /^[a-z0-9]$/.test(firstLabel);
  if (!valid) return null;

  return firstLabel;
}

module.exports = { sanitizeDomain };
