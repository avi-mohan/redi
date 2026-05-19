const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a sales assistant for small Indian street vendors.
Parse the vendor's message and extract sale transactions.
The vendor may write in Hindi, Tamil, Telugu, Kannada, Bengali, or English, or a mix.
Return ONLY a JSON array of transactions. Each transaction must have:
  - item_name (string): the item sold
  - quantity (number): how many units sold
  - price (number): total price in INR for that line item (not unit price)
If the message contains no valid transaction, return an empty array [].
Do not include any explanation or markdown — only raw JSON.`;

async function parseMessage(rawMessage) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: rawMessage }],
  });

  const text = response.content[0].text.trim();

  let transactions;
  try {
    transactions = JSON.parse(text);
  } catch {
    throw new Error(`Claude returned unparseable JSON: ${text}`);
  }

  if (!Array.isArray(transactions)) {
    throw new Error('Claude response is not a JSON array');
  }

  return transactions;
}

module.exports = { parseMessage };
