const CHAT_MODEL   = 'openai/gpt-oss-120b';
const REASON_MODEL = 'openai/gpt-oss-120b';
const MAX_MESSAGES = 20;
const MAX_CHARS = 8000;
const RATE_WINDOW = 60000;
const RATE_MAX = 30;
const rateBuckets = new Map();

const SYSTEM_PROMPT = `You are VOIDAI, a focused technical assistant built by Jacob.

IDENTITY:
- If asked "what model are you", "what engine", "what AI": reply "I am VOIDAI. Chat runs on Llama 3.3; reasoning and code run on DeepSeek-R1 — both via Groq."
- If asked who built you: "I am VOIDAI, built by Jacob."
- For casual self-questions ("how are you", "whats up"): reply naturally. Do NOT recite the identity line.

CAPABILITIES:
- Expert-level chat, coding, math, reasoning, analysis, writing.
- Live web search is available. Use it when the question involves news, prices, weather, scores, recent events, current people, or anything time-sensitive.
- Cite source URLs inline when you use search results.
- If no search results are provided and the question needs live data, say: "I do not have live data on that."

TRUTHFULNESS:
- NEVER fabricate news, dates, statistics, quotes, citations.
- Say "I am not certain" when unsure. Say "I do not know" rather than guess.

MATH:
- Arithmetic: respond with just the answer. "whats 1 add 1" -> "2".

VOICE:
- Direct, technical, no filler. Match user length. No emojis unless user uses one first.

FORMAT:
- Code in markdown fences with language tag. Bullet lists for enumerations. Prose otherwise.`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-VOID-KEY'
      }});
    }
    const key = request.headers.get('X-VOID-KEY') || '';
    if (key !== env.VOIDAI) return json({ error: { message: 'unauthorized' } }, 401);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const b = rateBuckets.get(ip) || { count: 0, reset: now + RATE_WINDOW };
    if (now > b.reset) { b.count = 0; b.reset = now + RATE_WINDOW; }
    b.count++;
    rateBuckets.set(ip, b);
    if (b.count > RATE_MAX) return json({ error: { message: 'rate limit' } }, 429);

    if (request.method === 'GET') {
      return json({ status: 'ok', chat: CHAT_MODEL, reason: REASON_MODEL, provider: 'groq', search: !!env.TAVILY_API_KEY });
    }
    if (request.method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: { message: 'invalid json' } }, 400); }

    let messages = Array.isArray(body.messages) ? body.messages : [];
    messages = messages.filter(m => m && m.role !== 'system').slice(-MAX_MESSAGES)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, MAX_CHARS) }));
    if (!messages.length) return json({ error: { message: 'no messages' } }, 400);

    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const reasoningRe = /\b(solve|prove|derive|calculate|why does|explain why|debug|refactor|algorithm|complexity|equation|integral|derivative|write (a )?(function|class|script|program|code))\b/i;
    const liveRe = /\b(latest|current|today|tonight|yesterday|this (week|month|year)|news|weather|temperature|forecast|price|stock|score|recent|2025|2026|who is the (current|new))\b/i;
    const useReason = reasoningRe.test(lastUser);
    const wantSearch = env.TAVILY_API_KEY && liveRe.test(lastUser);

    let searchContext = '';
    if (wantSearch) {
      try {
        const sr = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: env.TAVILY_API_KEY,
            query: lastUser.slice(0, 400),
            max_results: 5,
            search_depth: 'basic'
          })
        });
        const data = await sr.json();
        if (Array.isArray(data.results) && data.results.length) {
          searchContext = 'LIVE SEARCH RESULTS (use these, cite URLs):\n\n' +
            data.results.map(r => `• ${r.title}\n  ${r.url}\n  ${(r.content || '').slice(0, 400)}`).join('\n\n');
        }
      } catch (e) {
        searchContext = 'SEARCH FAILED — tell the user you could not reach live data.';
      }
    }

    const model = useReason ? REASON_MODEL : CHAT_MODEL;
    const fullSystem = searchContext ? SYSTEM_PROMPT + '\n\n' + searchContext : SYSTEM_PROMPT;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: fullSystem }, ...messages],
        max_tokens: 3000,
        temperature: useReason ? 0.3 : 0.6
      })
    });
    const text = await groqRes.text();
    return new Response(text, { status: groqRes.status, headers: {
      'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'
    }});
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: {
    'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'
  }});
}
