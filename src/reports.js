const { query, getTransactionsForDate, getExpensesForDate, getStockAlertsForDate, updateDailySummary } = require('./db');
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
  const [transactions, expenses, stockAlerts] = await Promise.all([
    getTransactionsForDate(vendorId, date),
    getExpensesForDate(vendorId, date),
    getStockAlertsForDate(vendorId, date),
  ]);

  const kamayi  = transactions.reduce((s, t) => s + Number(t.price), 0);
  const kharcha = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const bachat  = kamayi - kharcha;

  await updateDailySummary(vendorId, date, kamayi, transactions.length);

  if (!kamayi && !kharcha && !stockAlerts.length) {
    return 'Aaj koi hisaab nahi mila 😔 Kal aur achha hoga!';
  }

  const lines = [
    'Aaj ka hisaab 📊',
    `💰 Kamayi: ₹${kamayi}`,
    `💸 Kharcha: ₹${kharcha}`,
    `🐷 Bachat: ₹${bachat}`,
    `✅ Haath mein: ₹${bachat}`,
  ];

  if (transactions.length > 0) {
    const itemMap = {};
    for (const t of transactions) {
      if (!itemMap[t.item_name]) itemMap[t.item_name] = { qty: 0, price: 0 };
      itemMap[t.item_name].qty   += Number(t.quantity);
      itemMap[t.item_name].price += Number(t.price);
    }
    lines.push('', 'Aaj kya bika:');
    for (const [name, { qty, price }] of Object.entries(itemMap)) {
      lines.push(`- ${name} × ${qty} — ₹${price}`);
    }
  }

  if (expenses.length > 0) {
    lines.push('', 'Kharche:');
    for (const e of expenses) {
      lines.push(`- ${e.description || 'Kharcha'} — ₹${e.amount}`);
    }
  }

  if (stockAlerts.length > 0) {
    lines.push('', 'Stock khatam:');
    for (const a of stockAlerts) {
      lines.push(`- ${a.item_name}`);
    }
  }

  return lines.join('\n');
}

module.exports = { generateDailySummaries, buildVendorReport, generateAndUploadReport, buildTelegramSummary };
