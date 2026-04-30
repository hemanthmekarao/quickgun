const axios = require('axios');

const RDAP_TIMEOUT = 7000; // ms per TLD
const CONCURRENCY  = 8;    // parallel RDAP requests

async function checkDomainRDAP(domain, tld) {
  const fqdn = `${domain}.${tld}`.toLowerCase();
  try {
    const resp = await axios.get(`https://rdap.org/domain/${fqdn}`, {
      timeout: RDAP_TIMEOUT,
      validateStatus: () => true,
      headers: {
        'Accept':     'application/rdap+json, application/json',
        'User-Agent': 'DomainSearchApp/1.0',
      },
    });

    if (resp.status === 200) {
      // Check for redemption / expiring status — domain may be acquirable at auction
      const rdapStatuses = (resp.data?.status || []).map(s => s.toLowerCase());
      const auctionStatuses = ['redemption period', 'pending delete', 'pending restore', 'expired'];
      const isAuction = rdapStatuses.some(s => auctionStatuses.some(a => s.includes(a)));
      return { available: false, status: isAuction ? 'auction' : 'taken' };
    }
    if (resp.status === 404) return { available: true,   status: 'available' };
    if (resp.status === 400) return { available: null,   status: 'invalid' };
    if (resp.status === 429) return { available: null,   status: 'rate_limited' };
    if (resp.status >= 500)  return { available: null,   status: 'error' };

    return { available: null, status: 'unknown' };
  } catch (err) {
    const code = err.code || '';
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
      return { available: null, status: 'timeout' };
    }
    return { available: null, status: 'error' };
  }
}

/**
 * Check an array of TLDs with bounded concurrency.
 * Calls onResult(tld, result) as each check completes.
 * Returns a promise that resolves when all checks are done.
 */
function checkDomainsStream(domain, tlds, onResult, aborted, concurrency = CONCURRENCY) {
  return new Promise((resolve) => {
    const queue    = [...tlds];
    let active     = 0;
    let completed  = 0;
    const total    = tlds.length;

    if (total === 0) { resolve(); return; }

    function dispatch() {
      while (active < concurrency && queue.length > 0) {
        if (aborted && aborted()) { resolve(); return; }

        const tld = queue.shift();
        active++;

        checkDomainRDAP(domain, tld)
          .then(result => {
            if (!aborted || !aborted()) onResult(tld, result);
          })
          .catch(() => {
            onResult(tld, { available: null, status: 'error' });
          })
          .finally(() => {
            active--;
            completed++;
            if (completed === total) resolve();
            else dispatch();
          });
      }
    }

    dispatch();
  });
}

module.exports = { checkDomainRDAP, checkDomainsStream };
