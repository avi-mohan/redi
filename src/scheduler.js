const cron = require('node-cron');
const { query } = require('./db');
const { generateDailySummaries, generateAndUploadReport } = require('./reports');
const { getBot } = require('./bot');

function startScheduler() {
  const schedule = process.env.REPORT_CRON_SCHEDULE || '0 21 * * *';

  cron.schedule(schedule, runNightlyReports, { timezone: 'Asia/Kolkata' });

  console.log(`Scheduler started. Nightly reports cron: ${schedule} IST`);
}

async function runNightlyReports() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Running nightly reports for ${today}…`);

  try {
    await generateDailySummaries(today);
  } catch (err) {
    console.error('Failed to generate daily summaries:', err);
    return;
  }

  const { rows: vendors } = await query('SELECT id, telegram_id FROM vendors');
  const bot = getBot();

  for (const vendor of vendors) {
    try {
      const { url, report } = await generateAndUploadReport(vendor.id, today);

      if (bot) {
        await bot.sendMessage(
          vendor.telegram_id,
          `*Your Daily Report — ${today}*\n\n\`\`\`\n${report}\n\`\`\`\n\n[Download full report](${url})`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (err) {
      console.error(`Failed report for vendor ${vendor.id}:`, err);
    }
  }

  console.log(`Nightly reports done for ${today}.`);
}

module.exports = { startScheduler, runNightlyReports };
