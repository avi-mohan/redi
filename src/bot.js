const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const { parseMessage } = require('./parser');
const { registerVendor, getVendorByTelegramId, saveTransaction, saveExpense, saveSavings, logStockAlert } = require('./db');
const { uploadRawMessage } = require('./s3');
const { buildTelegramSummary } = require('./reports');
const { transcribeVoice } = require('./transcribe');
const { answerQuery } = require('./query');

let bot;

function initBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

  bot.onText(/\/start/, (msg) => handleStart(msg).catch(console.error));
  bot.onText(/\/report/, (msg) => handleReport(msg).catch(console.error));
  bot.on('voice', (msg) => handleVoice(msg).catch(console.error));
  bot.on('message', (msg) => handleMessage(msg).catch(console.error));

  return bot;
}

function processUpdate(update) {
  bot.processUpdate(update);
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleStart(msg) {
  const telegramId = String(msg.from.id);
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'दोस्त';

  const vendor = await registerVendor(telegramId, name);

  if (vendor.created_now) {
    await reply(
      msg.chat.id,
      `नमस्ते ${name}! 🙏 मैं Redi हूं।\n\nबिक्री बताओ: "2 chai 20 ki"\nखर्चा बताओ: "stock mein 400 laga"\nहिसाब देखो: "hisaab dikhao"\n\nसब लिख लूंगा! ✍️`
    );
  } else {
    await reply(msg.chat.id, `वापस आ गए ${name}! 😊 बताओ, क्या बिका आज?`);
  }
}

async function handleReport(msg) {
  const vendor = await getVendorByTelegramId(String(msg.from.id));
  if (!vendor) return reply(msg.chat.id, '/start भेजो पहले 🙏');

  const message = await buildTelegramSummary(vendor.id, istDate());
  return reply(msg.chat.id, message);
}

// ── Message handlers ──────────────────────────────────────────────────────────

async function handleMessage(msg) {
  if (!msg.text || msg.text.startsWith('/')) return;

  const vendor = await getVendorByTelegramId(String(msg.from.id));
  if (!vendor) return reply(msg.chat.id, '/start भेजो पहले 🙏');

  uploadRawMessage(vendor.id, { text: msg.text, receivedAt: new Date().toISOString() })
    .catch((err) => console.error('S3 upload failed:', err));

  await processText(msg.chat.id, vendor, msg.text);
}

async function handleVoice(msg) {
  const vendor = await getVendorByTelegramId(String(msg.from.id));
  if (!vendor) return reply(msg.chat.id, '/start भेजो पहले 🙏');

  await reply(msg.chat.id, '🎤 सुना, एक सेकंड...');

  const fileLink = await bot.getFileLink(msg.voice.file_id);
  const audioBuffer = await downloadBuffer(fileLink);

  let transcript;
  try {
    transcript = await transcribeVoice(vendor.id, audioBuffer, Date.now());
  } catch (err) {
    console.error('Transcription error:', err);
    return reply(msg.chat.id, 'आवाज़ समझ नहीं आई 🙏 फिर से भेजो');
  }

  if (!transcript || !transcript.trim()) {
    return reply(msg.chat.id, 'आवाज़ साफ़ नहीं थी 🙏 फिर से बोलो');
  }

  await processText(msg.chat.id, vendor, transcript);
}

// ── Shared text routing ───────────────────────────────────────────────────────

async function processText(chatId, vendor, rawText) {
  let parsed;
  try {
    parsed = await parseMessage(rawText);
  } catch (err) {
    console.error('Parser error:', err);
    return reply(chatId, 'कुछ गड़बड़ हुई, फिर से भेजो 🙏');
  }

  switch (parsed.type) {
    case 'sale':
      return handleSale(chatId, vendor, parsed.transactions, rawText);

    case 'expense':
      await saveExpense(vendor.id, parsed.amount, parsed.description, rawText);
      return reply(chatId, `खर्चा लिख लिया 💸\n₹${parsed.amount}${parsed.description ? ` — ${parsed.description}` : ''}`);

    case 'savings':
      await saveSavings(vendor.id, parsed.amount, rawText);
      return reply(chatId, `₹${parsed.amount} बचत में डाल दिया 🐷`);

    case 'stock_out':
      await logStockAlert(vendor.id, parsed.item);
      return reply(chatId, `${parsed.item} का स्टॉक खत्म नोट कर लिया 📝`);

    case 'report': {
      const message = await buildTelegramSummary(vendor.id, istDate());
      return reply(chatId, message);
    }

    case 'question':
      return handleQuestion(chatId, vendor, rawText);

    case 'unclear': {
      const itemList = (parsed.items || []).join(' और ');
      return reply(chatId, `भाई, ${itemList} अलग अलग कितने के थे? दोबारा भेजो 🙏`);
    }

    default:
      return reply(chatId, 'समझ नहीं आया 🤔 ऐसे बताओ: "2 chai 20 ki"');
  }
}

async function handleSale(chatId, vendor, transactions, rawText) {
  if (!transactions || transactions.length === 0) {
    return reply(chatId, 'समझ नहीं आया 🤔 ऐसे बताओ: "2 chai 20 ki"');
  }

  for (const t of transactions) {
    await saveTransaction(vendor.id, t.item, t.quantity, t.price, rawText);
  }

  const lines = transactions.map((t) => {
    const qty = t.unit ? `${t.quantity} ${t.unit}` : t.quantity;
    return `• ${t.item} × ${qty} — ₹${t.price}`;
  }).join('\n');
  const total  = transactions.reduce((sum, t) => sum + Number(t.price), 0);
  const text   = transactions.length === 1
    ? `लिख लिया ✅\n${lines}`
    : `लिख लिया ✅\n${lines}\n\nकुल: ₹${total}`;

  return reply(chatId, text);
}

async function handleQuestion(chatId, vendor, question) {
  let answer;
  try {
    answer = await answerQuery(question, vendor.id);
  } catch (err) {
    console.error('Query error:', err);
    return reply(chatId, 'हिसाब निकालने में दिक्कत हुई 🙏 फिर से पूछो');
  }
  return reply(chatId, answer);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function reply(chatId, text) {
  return bot.sendMessage(chatId, text);
}

function istDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function getBot() {
  return bot;
}

module.exports = { initBot, processUpdate, getBot };
