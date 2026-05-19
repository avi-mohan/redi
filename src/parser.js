const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You parse sales messages from small Indian street vendors into JSON.

Messages come in Hindi, English, Hinglish, or regional languages.
Common patterns:
  "2 thums up 20 ki"          → 2 Thums Up for ₹20 total
  "3 wills 36 mein"           → 3 Wills cigarettes for ₹36 total
  "chai 5 cup 50 rs"          → 5 cups of chai for ₹50 total
  "samosa 10 becha 30 mein"   → 10 samosas for ₹30 total
  "ek bread 25 ka"            → 1 bread for ₹25

Return ONLY a JSON array. Each object must have exactly these keys:
  "item"     — string, the product name (capitalize properly, e.g. "Thums Up", "Wills", "Chai")
  "quantity" — number, units sold
  "price"    — number, total rupees for that line (not per unit)

Rules:
- "X ki", "X mein", "X ka", "X rs", "X rupee" all mean total price is X
- "ek" = 1, "do" = 2, "teen" = 3, "char" = 4, "paanch" = 5
- Multiple items in one message → multiple objects in the array
- If no valid sale found, return []
- No markdown, no explanation — raw JSON only`;

async function parseMessage(rawMessage) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: rawMessage }],
  });

  const text = response.content[0].text.trim();

  let transactions;
  try {
    transactions = JSON.parse(text);
  } catch {
    throw new Error(`Unparseable response from Claude: ${text}`);
  }

  if (!Array.isArray(transactions)) {
    throw new Error('Claude response is not a JSON array');
  }

  return transactions;
}

module.exports = { parseMessage };
