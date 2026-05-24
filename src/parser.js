const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You classify and parse messages from small Indian street vendors.

Return a single JSON object with a "type" field. Exactly one of these shapes:

1. SALE — vendor sold items with individual prices:
   {"type":"sale","transactions":[{"item":"...","quantity":N,"price":N}]}
   Rules: price = total rupees for that line (not per unit)
          "X ki/mein/ka/rs/rupee" = total is X
          "ek"=1 "do"=2 "teen"=3 "char"=4 "paanch"=5

2. EXPENSE — vendor spent money on stock/supplies/bills:
   {"type":"expense","amount":N,"description":"..."}
   Examples: "stock mein 400 laga", "200 ka samaan liya", "bijli 150 diya"

3. SAVINGS — vendor setting aside money:
   {"type":"savings","amount":N}
   Examples: "aaj 100 bachaya", "200 bacha ke rakha"

4. QUESTION — vendor asking about their sales or business data:
   {"type":"question"}
   Examples: "ab tak kitna hua", "aaj kitna kamaya", "wills kitni biki",
             "is hafte ka hisaab", "konsa item zyada bika", "kitna bacha"

5. UNCLEAR — multiple items mentioned but only one combined price (cannot split fairly):
   {"type":"unclear","items":["Item1","Item2"]}
   Example: "ek chai ek advance 28 rupay" → cannot know chai vs Advance price

6. UNKNOWN — nothing recognized:
   {"type":"unknown"}

Common panwadi items (recognize these by name):
  Cigarettes : Gold Flake, Wills, Classic, Navy Cut, Advance, Four Square, Bristol, Capstan
  Cold drinks: Thums Up, Pepsi, Sprite, Limca, Maaza, Frooti, Sting, Red Bull
  Snacks     : samosa, bread pakoda, chai, coffee, biscuit, chips, namkeen
  Pan/tobacco: pan, gutka, zarda, khaini, mawa

Return ONLY raw JSON. No markdown, no explanation.`;

async function parseMessage(rawMessage) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: rawMessage }],
  });

  const raw = response.content[0].text.trim();
  const text = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Unparseable response from Claude: ${text}`);
  }

  if (!parsed || typeof parsed.type !== 'string') {
    throw new Error('Claude response missing type field');
  }

  return parsed;
}

module.exports = { parseMessage };
