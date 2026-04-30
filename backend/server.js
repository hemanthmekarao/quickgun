require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { initTldService } = require('./services/tldService');

const app = express();

app.use(cors({
  origin:      process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

// Rate limiters
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

// Routes
app.use('/api/auth',    authLimiter,   require('./routes/auth'));
app.use('/api/search',  searchLimiter, require('./routes/search'));
app.use('/api/history',                require('./routes/history'));
app.use('/api/tlds',                   require('./routes/tlds'));
app.use('/api/ai',                     require('./routes/ai'));

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

async function start() {
  await initTldService();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`[server] listening on http://localhost:${port}`));
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
