require('dotenv').config();

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      { rejectUnauthorized: false },
});

async function connectDb() {
  const client = await pool.connect();
  console.log('Connected to PostgreSQL.');
  client.release();
}

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const migrationDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationDir).sort();

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log(`Applied migration: ${file}`);
  }
}

// Upserts the vendor and flags whether this is the first registration.
async function registerVendor(telegramId, name) {
  const existing = await pool.query(
    'SELECT id, name FROM vendors WHERE telegram_id = $1',
    [telegramId]
  );
  if (existing.rows.length > 0) {
    return { ...existing.rows[0], created_now: false };
  }
  const { rows } = await pool.query(
    'INSERT INTO vendors (telegram_id, name) VALUES ($1, $2) RETURNING id, name',
    [telegramId, name]
  );
  return { ...rows[0], created_now: true };
}

async function getVendorByTelegramId(telegramId) {
  const { rows } = await pool.query(
    'SELECT id, name, telegram_id FROM vendors WHERE telegram_id = $1',
    [telegramId]
  );
  return rows[0] || null;
}

async function getAllVendors() {
  const { rows } = await pool.query('SELECT id, name, telegram_id FROM vendors');
  return rows;
}

async function saveTransaction(vendorId, itemName, quantity, price, rawMessage) {
  const { rows } = await pool.query(
    `INSERT INTO transactions (vendor_id, item_name, quantity, price, raw_message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [vendorId, itemName, quantity, price, rawMessage]
  );
  return rows[0];
}

async function getTransactionsForDate(vendorId, date) {
  const { rows } = await pool.query(
    `SELECT item_name, quantity, price
     FROM transactions
     WHERE vendor_id = $1
       AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2
     ORDER BY created_at`,
    [vendorId, date]
  );
  return rows;
}

async function getDailySummary(vendorId, date) {
  const { rows } = await pool.query(
    'SELECT * FROM daily_summaries WHERE vendor_id = $1 AND date = $2',
    [vendorId, date]
  );
  return rows[0] || null;
}

async function updateDailySummary(vendorId, date, revenue, count) {
  const { rows } = await pool.query(
    `INSERT INTO daily_summaries (vendor_id, date, total_revenue, transaction_count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (vendor_id, date) DO UPDATE
       SET total_revenue     = EXCLUDED.total_revenue,
           transaction_count = EXCLUDED.transaction_count
     RETURNING *`,
    [vendorId, date, revenue, count]
  );
  return rows[0];
}

// Low-level escape hatch for reports.js and ad-hoc queries
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  connectDb,
  runMigrations,
  registerVendor,
  getVendorByTelegramId,
  getAllVendors,
  saveTransaction,
  getTransactionsForDate,
  getDailySummary,
  updateDailySummary,
  query,
};
