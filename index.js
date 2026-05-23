require('dotenv').config();

const fs = require('fs');
const http = require('http');
const https = require('https');
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

const redirectApp = express();
redirectApp.use((req, res) => {
  res.redirect(301, `https://${req.headers.host}${req.url}`);
});

async function main() {
  await connectDb();

  const bot = initBot();

  if (process.env.WEBHOOK_URL) {
    await bot.setWebHook(`${process.env.WEBHOOK_URL}/webhook`);
    console.log(`Webhook registered: ${process.env.WEBHOOK_URL}/webhook`);
  }

  startScheduler();

  const tlsOptions = {
    cert: fs.readFileSync('/etc/letsencrypt/live/redi.avi-mohan.me/fullchain.pem'),
    key:  fs.readFileSync('/etc/letsencrypt/live/redi.avi-mohan.me/privkey.pem'),
  };

  https.createServer(tlsOptions, app).listen(443, () =>
    console.log('Redi listening on port 443 (HTTPS)')
  );

  http.createServer(redirectApp).listen(80, () =>
    console.log('HTTP redirect listening on port 80')
  );
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
