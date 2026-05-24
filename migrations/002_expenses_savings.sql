CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  vendor_id   INTEGER     NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  amount      NUMERIC     NOT NULL,
  description TEXT,
  raw_message TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_vendor_date
  ON expenses (vendor_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date);

CREATE TABLE IF NOT EXISTS savings (
  id          SERIAL PRIMARY KEY,
  vendor_id   INTEGER     NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  amount      NUMERIC     NOT NULL,
  raw_message TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_savings_vendor_date
  ON savings (vendor_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date);
