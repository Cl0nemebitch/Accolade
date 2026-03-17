require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Auto-create tables on startup
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        participant_id  VARCHAR(30)  PRIMARY KEY,
        name            VARCHAR(150) NOT NULL,
        coins_balance   INT          NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        item_id     VARCHAR(30)  PRIMARY KEY,
        name        VARCHAR(150) NOT NULL,
        coins_cost  INT          NOT NULL CHECK (coins_cost > 0),
        active      BOOLEAN      NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS coin_awards (
        award_id        SERIAL       PRIMARY KEY,
        participant_id  VARCHAR(30)  NOT NULL REFERENCES participants(participant_id),
        coins_awarded   INT          NOT NULL CHECK (coins_awarded > 0),
        reason          VARCHAR(300),
        awarded_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS redemptions (
        redemption_id   SERIAL      PRIMARY KEY,
        participant_id  VARCHAR(30) NOT NULL REFERENCES participants(participant_id),
        item_id         VARCHAR(30) NOT NULL REFERENCES menu_items(item_id),
        coins_spent     INT         NOT NULL,
        redeemed_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
        redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (participant_id, redeemed_date)
      );

      INSERT INTO menu_items (item_id, name, coins_cost) VALUES
        ('chai',      'Chai',            30),
        ('samosa',    'Samosa (2 pcs)',   20),
        ('colddrink', 'Cold Drink',       40),
        ('sandwich',  'Veg Sandwich',     60),
        ('thali',     'Lunch Thali',     100)
      ON CONFLICT (item_id) DO NOTHING;
    `);
    console.log('Database initialised');
  } finally {
    client.release();
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.disable('x-powered-by');

const allowedOrigins = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (!allowedOrigins.length) return cb(null, true);
    return allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'x-volunteer-pin', 'x-admin-password']
}));

app.use(express.json({ limit: '100kb' }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; " +
    "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' *");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

const distPath = path.join(__dirname, 'dist');
const publicPath = path.join(__dirname, 'public');
const hasDist = fs.existsSync(path.join(distPath, 'index.html'));
app.use(express.static(hasDist ? distPath : publicPath));

// PIN auth middleware
function requirePin(req, res, next) {
  const pin = String(req.headers['x-volunteer-pin'] || req.body?.pin || '');
  if (pin !== process.env.VOLUNTEER_PIN) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  next();
}

function requireAdmin(req, res, next) {
  const pass = String(req.headers['x-admin-password'] || req.body?.password || '');
  if (pass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  next();
}

function isSafeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(value);
}

function isSafeName(value, max = 150) {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max;
}

// ── Routes: Participants ───────────────────────────────────────────────────────
// GET all participants (leaderboard)
app.get('/api/participants', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT participant_id, name, coins_balance, created_at FROM participants ORDER BY coins_balance DESC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET single participant by ID or name
app.get('/api/participants/search', async (req, res) => {
  const { q } = req.query;
  if (!q || String(q).length > 120) return res.status(400).json({ error: 'Query required' });
  try {
    const { rows } = await pool.query(
      `SELECT p.participant_id, p.name, p.coins_balance,
              (SELECT redeemed_date FROM redemptions r
               WHERE r.participant_id = p.participant_id AND r.redeemed_date = CURRENT_DATE
               LIMIT 1) AS redeemed_today
       FROM participants p
       WHERE LOWER(p.participant_id) = LOWER($1) OR LOWER(p.name) ILIKE $2
       LIMIT 5`,
      [q, `%${q}%`]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST register participant (volunteer only)
app.post('/api/participants', requirePin, async (req, res) => {
  const { participant_id, name, coins_balance = 0 } = req.body;
  if (!isSafeId(participant_id) || !isSafeName(name)) {
    return res.status(400).json({ error: 'Invalid participant data' });
  }
  if (!Number.isInteger(coins_balance) || coins_balance < 0 || coins_balance > 100000) {
    return res.status(400).json({ error: 'Invalid starting coins' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO participants (participant_id, name, coins_balance) VALUES ($1, $2, $3) RETURNING *',
      [participant_id.trim(), name.trim(), coins_balance]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Participant ID already exists' });
    res.status(500).json({ error: e.message });
  }
});

// ── Routes: Coins ─────────────────────────────────────────────────────────────
// POST award coins (volunteer only)
app.post('/api/coins/award', requirePin, async (req, res) => {
  const { participant_id, coins_awarded, reason } = req.body;
  if (!isSafeId(participant_id)) return res.status(400).json({ error: 'Invalid participant_id' });
  if (!Number.isInteger(coins_awarded) || coins_awarded <= 0 || coins_awarded > 10000) {
    return res.status(400).json({ error: 'Invalid coins_awarded' });
  }
  if (reason && !isSafeName(reason, 300)) return res.status(400).json({ error: 'Invalid reason' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO coin_awards (participant_id, coins_awarded, reason) VALUES ($1, $2, $3)',
      [participant_id, coins_awarded, reason || null]
    );
    const { rows } = await client.query(
      'UPDATE participants SET coins_balance = coins_balance + $1 WHERE participant_id = $2 RETURNING *',
      [coins_awarded, participant_id]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Participant not found' }); }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Routes: Menu ──────────────────────────────────────────────────────────────
app.get('/api/menu', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM menu_items WHERE active = true ORDER BY coins_cost');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/menu/:item_id', requirePin, async (req, res) => {
  const { name, coins_cost, active } = req.body;
  if (!isSafeId(req.params.item_id)) return res.status(400).json({ error: 'Invalid item_id' });
  if (name && !isSafeName(name, 150)) return res.status(400).json({ error: 'Invalid name' });
  if (coins_cost !== undefined) {
    if (!Number.isInteger(coins_cost) || coins_cost <= 0 || coins_cost > 10000) {
      return res.status(400).json({ error: 'Invalid coins_cost' });
    }
  }
  try {
    const { rows } = await pool.query(
      'UPDATE menu_items SET name = COALESCE($1, name), coins_cost = COALESCE($2, coins_cost), active = COALESCE($3, active) WHERE item_id = $4 RETURNING *',
      [name, coins_cost, active, req.params.item_id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/menu', requirePin, async (req, res) => {
  const { item_id, name, coins_cost } = req.body;
  if (!isSafeId(item_id) || !isSafeName(name, 150)) {
    return res.status(400).json({ error: 'Invalid menu item' });
  }
  if (!Number.isInteger(coins_cost) || coins_cost <= 0 || coins_cost > 10000) {
    return res.status(400).json({ error: 'Invalid coins_cost' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO menu_items (item_id, name, coins_cost) VALUES ($1, $2, $3) RETURNING *',
      [item_id, name, coins_cost]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Item ID already exists' });
    res.status(500).json({ error: e.message });
  }
});

// ── Routes: Redemption ────────────────────────────────────────────────────────
app.post('/api/redeem', requirePin, async (req, res) => {
  const { participant_id, item_id } = req.body;
  if (!isSafeId(participant_id) || !isSafeId(item_id)) {
    return res.status(400).json({ error: 'participant_id and item_id required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pRows } = await client.query(
      'SELECT * FROM participants WHERE participant_id = $1 FOR UPDATE', [participant_id]
    );
    if (!pRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Participant not found' }); }
    const { rows: mRows } = await client.query('SELECT * FROM menu_items WHERE item_id = $1', [item_id]);
    if (!mRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Menu item not found' }); }
    const participant = pRows[0];
    const item = mRows[0];
    if (participant.coins_balance < item.coins_cost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient coins. Has ${participant.coins_balance}, needs ${item.coins_cost}` });
    }
    await client.query(
      'INSERT INTO redemptions (participant_id, item_id, coins_spent) VALUES ($1, $2, $3)',
      [participant_id, item_id, item.coins_cost]
    );
    const { rows: updated } = await client.query(
      'UPDATE participants SET coins_balance = coins_balance - $1 WHERE participant_id = $2 RETURNING *',
      [item.coins_cost, participant_id]
    );
    await client.query('COMMIT');
    res.json({ participant: updated[0], item, coins_spent: item.coins_cost });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Already redeemed today' });
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// GET today's redemptions (volunteer)
app.get('/api/redeem/today', requirePin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.redemption_id, p.name, p.participant_id, m.name AS item_name,
             r.coins_spent, r.redeemed_at
      FROM redemptions r
      JOIN participants p ON p.participant_id = r.participant_id
      JOIN menu_items m ON m.item_id = r.item_id
      WHERE r.redeemed_date = CURRENT_DATE
      ORDER BY r.redeemed_at DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Routes: Analytics (Admin) ─────────────────────────────────────────────────
app.get('/api/analytics', requireAdmin, async (req, res) => {
  try {
    const [summary, topEarners, awardsByReason, redemptionsByItem, coinsPerDay] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(DISTINCT p.participant_id) AS total_participants,
          COALESCE(SUM(a.coins_awarded), 0) AS total_coins_awarded,
          COALESCE(SUM(r.coins_spent), 0) AS total_coins_redeemed,
          COUNT(DISTINCT r.redemption_id) AS total_redemptions
        FROM participants p
        LEFT JOIN coin_awards a ON a.participant_id = p.participant_id
        LEFT JOIN redemptions r ON r.participant_id = p.participant_id
      `),
      pool.query(`
        SELECT participant_id, name, coins_balance
        FROM participants ORDER BY coins_balance DESC LIMIT 10
      `),
      pool.query(`
        SELECT COALESCE(reason, 'Unspecified') AS reason,
               SUM(coins_awarded) AS total, COUNT(*) AS count
        FROM coin_awards GROUP BY reason ORDER BY total DESC LIMIT 10
      `),
      pool.query(`
        SELECT m.name, COUNT(*) AS redemptions, SUM(r.coins_spent) AS coins_spent
        FROM redemptions r JOIN menu_items m ON m.item_id = r.item_id
        GROUP BY m.name ORDER BY redemptions DESC
      `),
      pool.query(`
        SELECT redeemed_date::text AS date, SUM(coins_spent) AS coins
        FROM redemptions GROUP BY redeemed_date ORDER BY redeemed_date
      `)
    ]);
    res.json({
      summary: summary.rows[0],
      topEarners: topEarners.rows,
      awardsByReason: awardsByReason.rows,
      redemptionsByItem: redemptionsByItem.rows,
      coinsPerDay: coinsPerDay.rows
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export all participants as CSV (admin)
app.get('/api/export/participants', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT participant_id, name, coins_balance, created_at FROM participants ORDER BY coins_balance DESC'
    );
    const safeCell = (value) => {
      const s = String(value ?? '');
      const guard = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${guard.replace(/"/g, '""')}"`;
    };
    const csv = ['ID,Name,Coins Balance,Registered At',
      ...rows.map(r => [
        safeCell(r.participant_id),
        safeCell(r.name),
        safeCell(r.coins_balance),
        safeCell(r.created_at)
      ].join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="accolade-participants.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Catch-all: serve frontend ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  const indexPath = hasDist ? path.join(distPath, 'index.html') : path.join(publicPath, 'index.html');
  res.sendFile(indexPath);
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`A Coins server running on port ${PORT}`));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
