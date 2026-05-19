require('dotenv').config();

const express = require('express');
const { connectDb } = require('./src/db');
const { initBot, processUpdate } = require('./src/bot');
const { startScheduler } = require('./src/scheduler');

const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

async function main() {
  await connectDb();

  const bot = initBot();

  if (process.env.WEBHOOK_URL) {
    await bot.setWebHook(`${process.env.WEBHOOK_URL}/webhook`);
    console.log(`Webhook registered: ${process.env.WEBHOOK_URL}/webhook`);
  }

  startScheduler();

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Redi listening on port ${port}`));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
