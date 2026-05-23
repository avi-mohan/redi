const cron = require('node-cron');
const { getAllVendors } = require('./db');
const { getBot } = require('./bot');
const { buildTelegramSummary } = require('./reports');

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
  const message = await buildTelegramSummary(vendor.id, date);
  await bot.sendMessage(vendor.telegram_id, message);
}

function getISTDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

module.exports = { startScheduler, runNightlyReports };
