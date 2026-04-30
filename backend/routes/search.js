const express        = require('express');
const jwt            = require('jsonwebtoken');
const { checkDomainsStream } = require('../services/rdapService');
const { getTldsForCategory } = require('../services/tldService');
const { saveHistory }        = require('../services/historyService');
const { sanitizeDomain }     = require('../utils/domainValidator');

const router = express.Router();

router.get('/stream', async (req, res) => {
  const { domain, category = 'popular', token } = req.query;

  // Auth is optional — unauthenticated users can search but history won't be saved
  let userId = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch { /* invalid token — treat as unauthenticated */ }
  }

  const cleanDomain = sanitizeDomain(domain);
  if (!cleanDomain) {
    return res.status(400).json({ error: 'Invalid domain name' });
  }

  // SSE headers — must be set before any write
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN || '*');
  res.flushHeaders();

  // Keep-alive heartbeat so proxies don't close the connection
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);

  let closed = false;
  req.on('close', () => { closed = true; clearInterval(heartbeat); });

  const tlds    = getTldsForCategory(category);
  const results = [];

  const sendEvent = (data) => {
    if (!res.writableEnded && !closed) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  await checkDomainsStream(
    cleanDomain,
    tlds,
    (tld, result) => {
      const entry = {
        tld,
        domain:     `${cleanDomain}.${tld}`,
        available:  result.available,
        status:     result.status,
        checkedAt:  new Date().toISOString(),
      };
      results.push(entry);
      sendEvent(entry);
    },
    () => closed,
    8
  );

  if (!res.writableEnded && !closed) {
    res.write('data: [DONE]\n\n');
  }

  clearInterval(heartbeat);

  // Persist to history after stream completes
  if (userId && results.length > 0) {
    saveHistory(userId, cleanDomain, category, results).catch(err =>
      console.error('[history] save failed:', err.message)
    );
  }

  if (!res.writableEnded) res.end();
});

module.exports = router;
