CREATE TABLE IF NOT EXISTS vendors (
  id          SERIAL PRIMARY KEY,
  telegram_id TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id          SERIAL PRIMARY KEY,
  vendor_id   INTEGER     NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  item_name   TEXT        NOT NULL,
  quantity    NUMERIC     NOT NULL,
  price       NUMERIC     NOT NULL,
  raw_message TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_vendor_date
  ON transactions (vendor_id, (created_at::date));

CREATE TABLE IF NOT EXISTS daily_summaries (
  id                SERIAL PRIMARY KEY,
  vendor_id         INTEGER     NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  date              DATE        NOT NULL,
  total_revenue     NUMERIC     NOT NULL DEFAULT 0,
  transaction_count INTEGER     NOT NULL DEFAULT 0,
  UNIQUE (vendor_id, date)
);
