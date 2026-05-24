CREATE TABLE IF NOT EXISTS stock_alerts (
  id          SERIAL PRIMARY KEY,
  vendor_id   INTEGER     NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  item_name   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_alerts_vendor_date
  ON stock_alerts (vendor_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date);
