require('dotenv').config();

const { initBot } = require('./src/bot');
const { connectDb } = require('./src/db');
const { startScheduler } = require('./src/scheduler');

async function main() {
  await connectDb();
  startScheduler();
  initBot();
  console.log('Redi bot is running.');
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
