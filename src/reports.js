const { query, getTransactionsForDate, updateDailySummary } = require('./db');
const { uploadReport } = require('./s3');

async function generateDailySummaries(date) {
  const dateStr = date || new Date().toISOString().slice(0, 10);

  const { rows: vendors } = await query('SELECT id FROM vendors');

  for (const vendor of vendors) {
    const { rows } = await query(
      `SELECT COUNT(*) AS transaction_count, COALESCE(SUM(price), 0) AS total_revenue
       FROM transactions
       WHERE vendor_id = $1 AND created_at::date = $2`,
      [vendor.id, dateStr]
    );

    const { transaction_count, total_revenue } = rows[0];

    await query(
      `INSERT INTO daily_summaries (vendor_id, date, total_revenue, transaction_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vendor_id, date) DO UPDATE
         SET total_revenue = EXCLUDED.total_revenue,
             transaction_count = EXCLUDED.transaction_count`,
      [vendor.id, dateStr, total_revenue, transaction_count]
    );
  }

  console.log(`Daily summaries generated for ${dateStr}.`);
}

async function buildVendorReport(vendorId, date) {
  const dateStr = date || new Date().toISOString().slice(0, 10);

  const { rows: vendorRows } = await query(
    'SELECT name, telegram_id FROM vendors WHERE id = $1',
    [vendorId]
  );
  if (vendorRows.length === 0) throw new Error(`Vendor ${vendorId} not found`);
  const vendor = vendorRows[0];

  const { rows: txns } = await query(
    `SELECT item_name, quantity, price, created_at
     FROM transactions
     WHERE vendor_id = $1 AND created_at::date = $2
     ORDER BY created_at`,
    [vendorId, dateStr]
  );

  const total = txns.reduce((sum, t) => sum + Number(t.price), 0);

  const lines = txns.map(
    (t) => `${t.created_at.toISOString().slice(11, 16)} | ${t.item_name} | qty:${t.quantity} | ₹${t.price}`
  );

  const report = [
    `Redi Daily Report`,
    `Vendor: ${vendor.name} (${vendor.telegram_id})`,
    `Date: ${dateStr}`,
    ``,
    `Transactions:`,
    ...lines,
    ``,
    `Total Revenue: ₹${total}`,
    `Transaction Count: ${txns.length}`,
  ].join('\n');

  return { report, vendor, total, count: txns.length };
}

async function generateAndUploadReport(vendorId, date) {
  const { report, vendor } = await buildVendorReport(vendorId, date);
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const key = `reports/${vendor.telegram_id}/${dateStr}.txt`;
  const url = await uploadReport(key, report);
  return { url, report };
}

async function buildTelegramSummary(vendorId, date) {
  const transactions = await getTransactionsForDate(vendorId, date);

  if (transactions.length === 0) {
    await updateDailySummary(vendorId, date, 0, 0);
    return 'Aaj koi bikri nahi hui 😔 Kal aur achha hoga!';
  }

  const totalRevenue = transactions.reduce((sum, t) => sum + Number(t.price), 0);

  const itemTotals = {};
  for (const t of transactions) {
    itemTotals[t.item_name] = (itemTotals[t.item_name] || 0) + Number(t.quantity);
  }
  const topItem = Object.entries(itemTotals).sort((a, b) => b[1] - a[1])[0];

  await updateDailySummary(vendorId, date, totalRevenue, transactions.length);

  return `Aaj ₹${totalRevenue} hua bhai 👍\nTop item: ${topItem[0]} (${topItem[1]} biki)`;
}

module.exports = { generateDailySummaries, buildVendorReport, generateAndUploadReport, buildTelegramSummary };
