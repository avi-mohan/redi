const Anthropic = require('@anthropic-ai/sdk');
const { query: dbQuery } = require('./db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SCHEMA = `
PostgreSQL tables (all timestamps stored in UTC):

  vendors(id, telegram_id, name, created_at)
  transactions(id, vendor_id, item_name, quantity, price, raw_message, created_at)
  expenses(id, vendor_id, amount, description, raw_message, created_at)
  savings(id, vendor_id, amount, raw_message, created_at)
  daily_summaries(id, vendor_id, date, total_revenue, transaction_count)

IST date expression: (created_at AT TIME ZONE 'Asia/Kolkata')::date
Always scope every table query to: vendor_id = $1
Use $1 as the placeholder for vendor_id — never embed it as a literal.
Use $2 as the placeholder for today's IST date — never embed date strings in the SQL.
`.trim();

async function answerQuery(question, vendorId) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  // Step 1: Generate SQL
  const sqlResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: `You generate safe PostgreSQL SELECT queries for a vendor analytics bot.

${SCHEMA}

Parameters available in the query:
  $1 = vendor_id (integer)
  $2 = today's date in IST (date, e.g. 2026-05-24)

Rules:
- Return ONLY the raw SQL — no markdown, no explanation
- Always start with SELECT
- Always include WHERE vendor_id = $1 (or equivalent JOIN condition)
- Use $2 wherever you need today's date — NEVER hardcode a date string
- Never use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, GRANT, or REVOKE`,
    messages: [{ role: 'user', content: question }],
  });

  const sql = sqlResponse.content[0].text
    .replace(/^```sql\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  assertSafeSQL(sql);

  // Step 2: Run query
  let rows;
  try {
    const result = await dbQuery(sql, [vendorId, today]);
    rows = result.rows;
  } catch (err) {
    throw new Error(`Query execution failed: ${err.message}`);
  }

  // Step 3: Format answer in Hindi
  const answerResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: `You are a helpful assistant for a small Indian street vendor.
Answer their question in simple, warm Hindi (2-3 sentences max).
Use ₹ for rupees. No English except brand names. No markdown.`,
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
