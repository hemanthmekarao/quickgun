/**
 * Registrars sorted by affiliate commission — highest first.
 * The first entry is shown as the primary "Register" button.
 * Replace placeholders with your actual affiliate IDs before deploying.
 *
 * Verified commission rates (2025-2026):
 *   Name.com   — up to 50% on new domain registrations (highest pure-domain affiliate)
 *   Dynadot    — up to 30% on domain sales
 *   Namecheap  — 20% on domains, 35% on hosting/SSL
 *   GoDaddy    — 10-15% on domain sales
 */
export const REGISTRARS = [
  {
    id:         'namedotcom',
    name:       'Name.com',
    badge:      '🏆 50% commission',
    commission: '50%',
    color:      '#6366f1',
    // Sign up at name.com/affiliates — replace YOUR_REF with your referral username
    getUrl: (domain) =>
      `https://www.name.com/domain/search/${encodeURIComponent(domain)}?ref=YOUR_REF`,
  },
  {
    id:         'dynadot',
    name:       'Dynadot',
    badge:      '💰 30% commission',
    commission: '30%',
    color:      '#f59e0b',
    // Sign up at dynadot.com/affiliate — replace YOUR_CODE with your partner code
    getUrl: (domain) =>
      `https://www.dynadot.com/?s39=${encodeURIComponent('YOUR_CODE')}&domain=${encodeURIComponent(domain)}`,
  },
  {
    id:         'namecheap',
    name:       'Namecheap',
    badge:      '⭐ 20% commission',
    commission: '20%',
    color:      '#de3723',
    // Sign up at namecheap.com/affiliates — replace YOUR_AFFILIATE_ID with your click-ref
    getUrl: (domain) =>
      `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}&clickref=YOUR_AFFILIATE_ID`,
  },
  {
    id:         'godaddy',
    name:       'GoDaddy',
    badge:      '',
    commission: '10%',
    color:      '#1bce6b',
    // Sign up at godaddy.com/affiliate — replace YOUR_ISC with your ISC code
    getUrl: (domain) =>
      `https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(domain)}&checkAvail=1&isc=YOUR_ISC`,
  },
];

export const PRIMARY_REGISTRAR = REGISTRARS[0];

/** Auction/aftermarket links for taken domains */
export const AUCTION_REGISTRARS = [
  {
    id:    'afternic',
    name:  'Afternic',
    badge: 'GoDaddy marketplace',
    getUrl: (domain) => `https://www.afternic.com/forsale/${encodeURIComponent(domain)}`,
  },
  {
    id:    'sedo',
    name:  'Sedo',
    badge: 'World\'s largest domain marketplace',
    getUrl: (domain) => `https://sedo.com/search/details/?domain=${encodeURIComponent(domain)}`,
  },
  {
    id:    'dan',
    name:  'Dan.com',
    badge: 'Instant purchase',
    getUrl: (domain) => `https://dan.com/buy-domain/${encodeURIComponent(domain)}`,
  },
];
