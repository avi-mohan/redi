const TelegramBot = require('node-telegram-bot-api');
const { parseMessage } = require('./parser');
const { query } = require('./db');

let bot;

function initBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

  bot.onText(/\/start/, handleStart);
  bot.onText(/\/summary/, handleSummary);
  bot.on('message', handleMessage);

  bot.on('polling_error', (err) => console.error('Polling error:', err));

  console.log('Telegram bot polling started.');
  return bot;
}

async function handleStart(msg) {
  const telegramId = String(msg.from.id);
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');

  const { rows } = await query(
    'SELECT id FROM vendors WHERE telegram_id = $1',
    [telegramId]
  );

  if (rows.length === 0) {
    await query(
      'INSERT INTO vendors (telegram_id, name) VALUES ($1, $2)',
      [telegramId, name]
    );
    await bot.sendMessage(
      msg.chat.id,
      `Namaste ${name}! 🙏 Welcome to Redi.\n\nSend me your sales like:\n"chai 10 cups 200 rupees"\n"samosa 20 pcs 100 rs"\n\nI'll track everything for you!`
    );
  } else {
    await bot.sendMessage(msg.chat.id, `Welcome back, ${name}! Send me your sales to log them.`);
  }
}

async function handleSummary(msg) {
  const telegramId = String(msg.from.id);
  const vendor = await getVendor(telegramId);
  if (!vendor) {
    return bot.sendMessage(msg.chat.id, 'Please send /start first to register.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT item_name, quantity, price FROM transactions
     WHERE vendor_id = $1 AND created_at::date = $2
     ORDER BY created_at`,
    [vendor.id, today]
  );

  if (rows.length === 0) {
    return bot.sendMessage(msg.chat.id, `No sales recorded today (${today}) yet.`);
  }

  const total = rows.reduce((sum, r) => sum + Number(r.price), 0);
  const lines = rows.map((r) => `• ${r.item_name} x${r.quantity} — ₹${r.price}`).join('\n');

  await bot.sendMessage(
    msg.chat.id,
    `*Today's Sales (${today})*\n\n${lines}\n\n*Total: ₹${total}*`,
    { parse_mode: 'Markdown' }
  );
}

async function handleMessage(msg) {
  if (!msg.text || msg.text.startsWith('/')) return;

  const telegramId = String(msg.from.id);
  const vendor = await getVendor(telegramId);
  if (!vendor) {
    return bot.sendMessage(msg.chat.id, 'Please send /start first to register.');
  }

  let transactions;
  try {
    transactions = await parseMessage(msg.text);
  } catch (err) {
    console.error('Parser error:', err);
    return bot.sendMessage(msg.chat.id, 'Sorry, I could not understand that. Please try again.');
  }

  if (transactions.length === 0) {
    return bot.sendMessage(msg.chat.id, "I didn't find any sales in that message. Try: \"chai 10 cups 200\"");
  }

  for (const t of transactions) {
    await query(
      `INSERT INTO transactions (vendor_id, item_name, quantity, price, raw_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [vendor.id, t.item_name, t.quantity, t.price, msg.text]
    );
  }

  const lines = transactions.map((t) => `✓ ${t.item_name} x${t.quantity} — ₹${t.price}`).join('\n');
  const total = transactions.reduce((sum, t) => sum + Number(t.price), 0);

  await bot.sendMessage(
    msg.chat.id,
    `Recorded!\n\n${lines}\n\nAdded ₹${total} to today's sales.`
  );
}

async function getVendor(telegramId) {
  const { rows } = await query(
    'SELECT id, name FROM vendors WHERE telegram_id = $1',
    [telegramId]
  );
  return rows[0] || null;
}

function getBot() {
  return bot;
}

module.exports = { initBot, getBot };
