const cron = require('node-cron');
const { getAllVendors, getTransactionsForDate, updateDailySummary } = require('./db');
const { getBot } = require('./bot');

function startScheduler() {
  // 10pm IST every night
  cron.schedule('0 22 * * *', runNightlyReports, { timezone: 'Asia/Kolkata' });
  console.log('Scheduler started. Nightly reports at 10pm IST.');
}

async function runNightlyReports() {
  const today = getISTDate();
  console.log(`Running nightly reports for ${today}…`);

  const vendors = await getAllVendors();
  const bot = getBot();

  for (const vendor of vendors) {
    try {
      await sendNightlyMessage(bot, vendor, today);
    } catch (err) {
      console.error(`Nightly report failed for vendor ${vendor.id}:`, err);
    }
  }
}

async function sendNightlyMessage(bot, vendor, date) {
  const transactions = await getTransactionsForDate(vendor.id, date);

  if (transactions.length === 0) {
    await bot.sendMessage(vendor.telegram_id, 'Aaj koi bikri nahi hui 😔 Kal aur achha hoga!');
    await updateDailySummary(vendor.id, date, 0, 0);
    return;
  }

  const totalRevenue = transactions.reduce((sum, t) => sum + Number(t.price), 0);

  // Aggregate by item to find the top seller
  const itemTotals = {};
  for (const t of transactions) {
    const key = t.item_name;
    itemTotals[key] = (itemTotals[key] || 0) + Number(t.quantity);
  }
  const topItem = Object.entries(itemTotals).sort((a, b) => b[1] - a[1])[0];

  await updateDailySummary(vendor.id, date, totalRevenue, transactions.length);

  const message =
    `Aaj ₹${totalRevenue} hua bhai 👍\n` +
    `Top item: ${topItem[0]} (${topItem[1]} biki)`;

  await bot.sendMessage(vendor.telegram_id, message);
}

function getISTDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

module.exports = { startScheduler, runNightlyReports };
