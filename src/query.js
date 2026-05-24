const Anthropic = require('@anthropic-ai/sdk');
const { query: dbQuery } = require('./db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SCHEMA = `
PostgreSQL tables (all timestamps stored in UTC):

  vendors(id, telegram_id, name, created_at)
  transactions(id, vendor_id, item_name, quantity, price, raw_message, created_at)
  expenses(id, vendor_id, amount, description, raw_message, created_at)
  savings(id, vendor_id, amount, raw_message, created_at)
  stock_alerts(id, vendor_id, item_name, created_at)
  daily_summaries(id, vendor_id, date, total_revenue, transaction_count)

IST date expression: (created_at AT TIME ZONE 'Asia/Kolkata')::date
Always scope every table query to: vendor_id = $1
`.trim();

async function answerQuery(question, vendorId) {
  const istFmt  = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
  const today     = istFmt.format(new Date());
  const yesterday = istFmt.format(new Date(Date.now() - 86400000));

  // Step 1: Generate SQL
  const sqlResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: `You generate safe PostgreSQL SELECT queries for a vendor analytics bot.

${SCHEMA}

Parameters always available — use these, never hardcode dates or IDs:
  $1 = vendor_id (integer)
  $2 = today's IST date (date)
  $3 = yesterday's IST date (date)

Rules:
- Return ONLY the raw SQL — no markdown, no explanation
- Always start with SELECT
- Always include WHERE vendor_id = $1 (or equivalent JOIN condition)
- For today queries: use (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2
- For yesterday queries: use (created_at AT TIME ZONE 'Asia/Kolkata')::date = $3
- For all-time / cumulative queries (e.g. total savings ever): omit the date filter entirely
- NEVER hardcode a date string in the SQL
- Never use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, GRANT, or REVOKE`,
    messages: [{ role: 'user', content: question }],
  });

  const sql = sqlResponse.content[0].text
    .replace(/^```sql\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  assertSafeSQL(sql);

  // Step 2: Run query
  let rows;
  try {
    const result = await dbQuery(sql, [vendorId, today, yesterday]);
    rows = result.rows;
  } catch (err) {
    throw new Error(`Query execution failed: ${err.message}`);
  }

  // Step 3: Format answer in Hindi
  const answerResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: `You are a helpful assistant for a small Indian street vendor.
ALWAYS reply in Hindi only — even if the vendor's question was in English or any other language.
Keep it short (1-3 sentences), warm, and simple. Use ₹ for rupees. No markdown.
Never use English words except brand names (Wills, Thums Up, Gold Flake, etc.).`,
    messages: [
      {
        role: 'user',
        content: `Vendor ka sawaal: "${question}"\n\nDatabase result: ${JSON.stringify(rows)}`,
      },
    ],
  });

  return answerResponse.content[0].text.trim();
}

function assertSafeSQL(sql) {
  const clean = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase().trim();
  if (!clean.startsWith('select')) {
    throw new Error('Only SELECT queries are permitted');
  }
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|execute|exec|copy)\b/.test(clean)) {
    throw new Error('Destructive SQL keyword detected');
  }
}

module.exports = { answerQuery };
