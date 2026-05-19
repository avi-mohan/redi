const TelegramBot = require('node-telegram-bot-api');
const { parseMessage } = require('./parser');
const { registerVendor, getVendorByTelegramId, saveTransaction } = require('./db');
const { uploadRawMessage } = require('./s3');

let bot;

function initBot() {
  // No polling or webhook server — updates arrive via Express /webhook
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

  bot.onText(/\/start/, (msg) => handleStart(msg).catch(console.error));
  bot.on('message', (msg) => handleMessage(msg).catch(console.error));

  return bot;
}

function processUpdate(update) {
  bot.processUpdate(update);
}

async function handleStart(msg) {
  const telegramId = String(msg.from.id);
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'दोस्त';

  const vendor = await registerVendor(telegramId, name);

  if (vendor.created_now) {
    await bot.sendMessage(
      msg.chat.id,
      `नमस्ते ${name}! 🙏 मैं Redi हूं।\n\nअपनी बिक्री बताओ, जैसे:\n_"2 chai 20 ki, 3 samosa 30 mein"_\n\nमैं सब लिख लूंगा! ✍️`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await bot.sendMessage(msg.chat.id, `वापस आ गए ${name}! 😊 बताओ, क्या बिका आज?`);
  }
}

async function handleMessage(msg) {
  if (!msg.text || msg.text.startsWith('/')) return;

  const telegramId = String(msg.from.id);
  const vendor = await getVendorByTelegramId(telegramId);

  if (!vendor) {
    return bot.sendMessage(msg.chat.id, '/start भेजो पहले 🙏');
  }

  // Fire-and-forget S3 archive — don't block the reply on it
  uploadRawMessage(vendor.id, { telegramId, text: msg.text, receivedAt: new Date().toISOString() })
    .catch((err) => console.error('S3 upload failed:', err));

  let transactions;
  try {
    transactions = await parseMessage(msg.text);
  } catch (err) {
    console.error('Parser error:', err);
    return bot.sendMessage(msg.chat.id, 'कुछ गड़बड़ हुई, फिर से भेजो 🙏');
  }

  if (transactions.length === 0) {
    return bot.sendMessage(msg.chat.id, 'समझ नहीं आया 🤔 जैसे बताओ: _"2 chai 20 ki"_', { parse_mode: 'Markdown' });
  }

  for (const t of transactions) {
    await saveTransaction(vendor.id, t.item, t.quantity, t.price, msg.text);
  }

  const lines = transactions.map((t) => `• ${t.item} × ${t.quantity} — ₹${t.price}`).join('\n');
  const total = transactions.reduce((sum, t) => sum + Number(t.price), 0);

  const reply =
    transactions.length === 1
      ? `लिख लिया ✅\n${lines}`
      : `लिख लिया ✅\n${lines}\n\nकुल: ₹${total}`;

  await bot.sendMessage(msg.chat.id, reply);
}

function getBot() {
  return bot;
}

module.exports = { initBot, processUpdate, getBot };
