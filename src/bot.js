const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const { parseMessage } = require('./parser');
const { registerVendor, getVendorByTelegramId, saveTransaction, saveExpense, saveSavings } = require('./db');
const { uploadRawMessage } = require('./s3');
const { buildTelegramSummary } = require('./reports');
const { transcribeVoice } = require('./transcribe');
const { answerQuery } = require('./query');
const { synthesize } = require('./polly');

let bot;

function initBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

  bot.onText(/\/start/, (msg) => handleStart(msg).catch(console.error));
  bot.onText(/\/report/, (msg) => handleReport(msg).catch(console.error));
  bot.onText(/\/savings\s+(\d+(?:\.\d+)?)/, (msg, match) => handleSavingsCmd(msg, match).catch(console.error));
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
      `नमस्ते ${name}! 🙏 मैं Redi हूं।\n\nअपनी बिक्री बताओ, जैसे:\n"2 chai 20 ki, 3 samosa 30 mein"\n\nमैं सब लिख लूंगा! ✍️`
    );
  } else {
    await reply(msg.chat.id, `वापस आ गए ${name}! 😊 बताओ, क्या बिका आज?`);
  }
}

async function handleReport(msg) {
  const vendor = await getVendorByTelegramId(String(msg.from.id));
  if (!vendor) return reply(msg.chat.id, '/start भेजो पहले 🙏');

  const today = istDate();
  const message = await buildTelegramSummary(vendor.id, today);
  await reply(msg.chat.id, message);
}

async function handleSavingsCmd(msg, match) {
  const vendor = await getVendorByTelegramId(String(msg.from.id));
  if (!vendor) return reply(msg.chat.id, '/start भेजो पहले 🙏');

  const amount = Number(match[1]);
  await saveSavings(vendor.id, amount, msg.text);
  await reply(msg.chat.id, `₹${amount} बचत में डाल दिया 🐷`);
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

// ── Shared text processing ────────────────────────────────────────────────────

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
      return reply(chatId, `खर्चा लिख लिया 💸 ₹${parsed.amount} (${parsed.description || 'kharcha'})`);

    case 'savings':
      await saveSavings(vendor.id, parsed.amount, rawText);
      return reply(chatId, `₹${parsed.amount} बचत में डाल दिया 🐷`);

    case 'question':
      return handleQuestion(chatId, vendor, rawText);

    case 'unclear': {
      const itemList = (parsed.items || []).join(' और ');
      return reply(chatId, `भाई, ${itemList} अलग अलग कितने के थे? दोबारा भेजो 🙏`);
    }

    default:
      return reply(chatId, 'समझ नहीं आया 🤔 जैसे बताओ: "2 chai 20 ki"');
  }
}

async function handleSale(chatId, vendor, transactions, rawText) {
  if (!transactions || transactions.length === 0) {
    return reply(chatId, 'समझ नहीं आया 🤔 जैसे बताओ: "2 chai 20 ki"');
  }

  for (const t of transactions) {
    await saveTransaction(vendor.id, t.item, t.quantity, t.price, rawText);
  }

  const lines = transactions.map((t) => `• ${t.item} × ${t.quantity} — ₹${t.price}`).join('\n');
  const total = transactions.reduce((sum, t) => sum + Number(t.price), 0);

  const text =
    transactions.length === 1
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

// ── Reply helper (text + audio) ───────────────────────────────────────────────

async function reply(chatId, text) {
  await bot.sendMessage(chatId, text);
  sendAudio(chatId, text).catch((err) => console.error('Polly error:', err));
}

async function sendAudio(chatId, text) {
  const plain = text.replace(/[*_`[\]()~>#+=|{}.!\-]/g, '').trim();
  if (!plain) return;
  const audio = await synthesize(plain);
  await bot.sendVoice(chatId, audio, {}, { filename: 'voice.mp3', contentType: 'audio/mpeg' });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

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
