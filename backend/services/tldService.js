const https = require('https');

const IANA_TLD_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
const REFRESH_MS   = 24 * 60 * 60 * 1000; // 24 h

// Curated category lists
const CURATED = {
  popular:  ['com', 'net', 'org', 'io', 'co', 'ai', 'app', 'dev', 'me', 'info', 'biz', 'us', 'online', 'site', 'tech'],
  business: ['com', 'net', 'biz', 'co', 'inc', 'llc', 'ltd', 'company', 'business', 'corp', 'store', 'shop', 'agency', 'group', 'ventures'],
  tech:     ['io', 'ai', 'dev', 'app', 'tech', 'cloud', 'software', 'digital', 'systems', 'network', 'data', 'api', 'code', 'solutions'],
};

let allTlds   = [];
let ccTlds    = [];
let newGtlds  = [];

function fetchIanaTlds() {
  return new Promise((resolve, reject) => {
    https.get(IANA_TLD_URL, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        const tlds = raw.split('\n')
          .filter(l => l && !l.startsWith('#'))
          .map(l => l.trim().toLowerCase())
          .filter(Boolean);
        resolve(tlds);
      });
    }).on('error', reject);
  });
}

async function initTldService() {
  try {
    const tlds = await fetchIanaTlds();
    allTlds  = tlds;
    ccTlds   = tlds.filter(t => t.length === 2);

    const known = new Set([
      ...CURATED.popular, ...CURATED.business, ...CURATED.tech, ...ccTlds
    ]);
    newGtlds = tlds.filter(t => !known.has(t));

    console.log(`[TLD] ${allTlds.length} TLDs loaded (${ccTlds.length} ccTLDs, ${newGtlds.length} new gTLDs)`);
  } catch (err) {
    console.warn('[TLD] IANA fetch failed, using fallback:', err.message);
    if (allTlds.length === 0) allTlds = CURATED.popular;
  }

  // Refresh daily
  setTimeout(initTldService, REFRESH_MS);
}

function getTldsForCategory(category) {
  switch (category) {
    case 'popular':  return CURATED.popular;
    case 'business': return CURATED.business;
    case 'tech':     return CURATED.tech;
    case 'country':  return ccTlds.slice(0, 60);
    case 'new':      return newGtlds.slice(0, 80);
    case 'all':      return allTlds.slice(0, 200);
    default:         return CURATED.popular;
  }
}

function getCategoryMeta() {
  return {
    popular:  { label: 'Popular',       count: CURATED.popular.length },
    business: { label: 'Business',      count: CURATED.business.length },
    tech:     { label: 'Technology',    count: CURATED.tech.length },
    country:  { label: 'Country (ccTLD)', count: ccTlds.length },
    new:      { label: 'New gTLDs',     count: newGtlds.length },
    all:      { label: 'All TLDs',      count: allTlds.length },
  };
}

module.exports = { initTldService, getTldsForCategory, getCategoryMeta };
