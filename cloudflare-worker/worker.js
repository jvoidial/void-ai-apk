// VOIDAI Cloudflare Worker
// Env vars required: SHARED_SECRET, OPENAI_API_KEY

const MODEL = 'gpt-4o-mini-search-preview';
const MAX_MESSAGES = 20;
const MAX_CHARS = 8000;
const RATE_WINDOW = 60000;
const RATE_MAX = 30;

const rateBuckets = new Map();

const SYSTEM_PROMPT = `You are VOIDAI.

IDENTITY:
- If asked what model you run on, reply exactly: "I am VOIDAI, running on OpenAI GPT-4o-mini with live web search."
- If asked who built you, reply: "I am VOIDAI, built by Jacob."
- For casual questions about yourself ("how are you", "whats up"), reply naturally. Do NOT recite the identity line.

LIVE DATA:
- You have live web search. Use it for: news, prices, weather, sports scores, stock quotes, "who is the current X", "when did Y happen", recent releases, anything that changes over time.
- Do NOT use search for stable knowledge: math, science, history, code, definitions.
- When you search, cite source URLs inline.
- If search returns nothing useful, say so. Do NOT guess.
- Never invent URLs, headlines, dates, or quotes.

MATH AND SIMPLE ARITHMETIC:
- When the user asks a calculation ("whats 1 add 1", "23 times 47", "12% of 340"), respond with just the answer or a short equation.
- Example: "whats 1 add 1" -> "2"
- Example: "whats 12% of 340" -> "40.8"
- Do not output operands on separate lines. Do not narrate the process unless asked.

VOICE:
- Direct, technical. No filler like "I would be happy to".
- Match the user's length. Short question, short answer.
- No emojis unless the user uses one first.

FORMAT:
- Code in markdown fences.
- Bullet lists for enumerations.
- Prose for conversation.`;

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-VOID-KEY',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // Auth
    const provided = request.headers.get('X-VOID-KEY') || '';
    const expected = env.SHARED_SECRET || '';
    if (!expected || provided !== expected) {
      return json({ error: { message: 'unauthorized' } }, 401);
    }

    // Rate limit
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(ip) || { count: 0, reset: now + RATE_WINDOW };
    if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + RATE_WINDOW; }
    bucket.count++;
    rateBuckets.set(ip, bucket);
    if (bucket.count > RATE_MAX) return json({ error: { message: 'rate limit' } }, 429);

    // Health probe
    if (request.method === 'GET') {
      return json({ status: 'ok', model: MODEL, provider: 'openai' });
    }

    if (request.method !== 'POST') {
      return json({ error: { message: 'method not allowed' } }, 405);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: { message: 'invalid json' } }, 400); }

    // Sanitize
    let messages = Array.isArray(body.messages) ? body.messages : [];
    messages = messages.filter(m => m && m.role !== 'system');
    messages = messages.slice(-MAX_MESSAGES);
    messages = messages
      .filter(m => (m.content || '').length <= MAX_CHARS)
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, MAX_CHARS)
      }));

    if (!messages.length) return json({ error: { message: 'no messages' } }, 400);

    messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    // OpenAI
    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 2000,
        web_search_options: { search_context_size: 'medium' }
      })
    });

    const text = await oaiRes.text();
    return new Response(text, {
      status: oaiRes.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
