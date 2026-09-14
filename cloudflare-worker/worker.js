const MODEL = 'openai/gpt-oss-120b';
const MAX_MESSAGES = 20;
const MAX_CHARS = 8000;
const RATE_WINDOW = 60000;
const RATE_MAX = 30;

const rateBuckets = new Map();

const liveRe = /\b(latest|current|today|tonight|yesterday|this (week|month|year)|news|weather|temperature|forecast|price|stock|score|recent|2025|2026|who is the (current|new))\b/i;
const weatherRe = /\b(weather|temperature|forecast|rain|snow|sunny|cloudy)\b/i;
const factRe = /\b(who|what|where|when)\s+(is|was|are|were)\b/i;

async function getWeather(query) {
  try {
    const loc = query
      .replace(/^(whats?|what's|what is|hows?|how's|how is|show me|give me|tell me)\s+/i, '')
      .replace(/\b(the\s+)?weather\b/i, '')
      .replace(/\b(today|tonight|tomorrow|now|currently|in|at|for|forecast)\b/gi, '')
      .replace(/[?.,!]/g, '')
      .trim();
    if (!loc) return '';

    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1`
    ).then(r => r.json());
    if (!geo.results || !geo.results.length) return '';

    const { latitude, longitude, name, country } = geo.results[0];
    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`
    ).then(r => r.json());

    const c = w.current;
    if (!c) return '';

    const codes = {
      0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
      45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
      61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',
      80:'Rain showers',81:'Rain showers',82:'Violent showers',
      95:'Thunderstorm',96:'Thunderstorm + hail',99:'Thunderstorm + heavy hail'
    };
    const cond = codes[c.weather_code] || ('Code ' + c.weather_code);

    return 'REAL WEATHER DATA (from Open-Meteo, cite as open-meteo.com):\n' +
      'Location: ' + name + ', ' + country + '\n' +
      'Temperature: ' + c.temperature_2m + '\u00B0C\n' +
      'Condition: ' + cond + '\n' +
      'Humidity: ' + c.relative_humidity_2m + '%\n' +
      'Wind: ' + c.wind_speed_10m + ' km/h\n' +
      'Time: ' + c.time;
  } catch (e) { return ''; }
}

async function getWiki(query) {
  try {
    const q = query
      .replace(/^(who|what|where|when|why|how)\s+(is|are|was|were|did|does|do)\s+/i, '')
      .replace(/[?.,!]/g, '').trim().slice(0, 120);
    if (!q) return '';

    const s = await fetch(
      'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
      encodeURIComponent(q) + '&format=json&origin=*&srlimit=1'
    ).then(r => r.json());
    const hit = s.query && s.query.search && s.query.search[0];
    if (!hit) return '';

    const extract = await fetch(
      'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(hit.title)
    ).then(r => r.json());
    if (!extract.extract) return '';

    return 'WIKIPEDIA RESULT (cite: en.wikipedia.org/wiki/' +
      encodeURIComponent(hit.title) + '):\n' + extract.extract;
  } catch (e) { return ''; }
}

async function searchTavily(query, env) {
  if (!env.TAVILY_API_KEY) return '';
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query: query.slice(0, 400),
        max_results: 5,
        search_depth: 'basic'
      })
    });
    const d = await r.json();
    if (!Array.isArray(d.results) || !d.results.length) return '';
    return d.results.map(function (x) {
      return '\u2022 ' + x.title + '\n  ' + x.url + '\n  ' + (x.content || '').slice(0, 400);
    }).join('\n\n');
  } catch (e) { return ''; }
}

function buildSystemPrompt(searchContext) {
  const base = 'You are VOIDAI, a focused technical assistant built by Jacob.\n\n' +
'IDENTITY:\n' +
'- If asked what model you are, say: "I am VOIDAI, running on OpenAI GPT-OSS 120B via Groq."\n' +
'- If asked who built you, say: "I am VOIDAI, built by Jacob."\n' +
'- For casual self-questions ("how are you", "whats up"), reply naturally. Do not recite the identity line.\n\n' +
'TRUTHFULNESS (non-negotiable):\n' +
'- NEVER invent temperatures, prices, scores, headlines, dates, or source URLs.\n' +
'- If the user asks about live data and no LIVE RESULTS are provided below, reply exactly: "I don\'t have live data on that. Try a news source."\n' +
'- If LIVE RESULTS are provided below, use only those and cite their source URLs inline.\n' +
'- If you are uncertain about a fact, say "I am not certain" before answering.\n\n' +
'MATH:\n' +
'- Arithmetic: respond with just the answer. "whats 1 add 1" -> "2".\n\n' +
'VOICE:\n' +
'- Direct, technical, no filler. Match user length. No emojis unless user uses one first.\n\n' +
'FORMAT:\n' +
'- Code in markdown fences. Bullet lists for enumerations. Prose otherwise.';

  return searchContext ? base + '\n\n' + searchContext : base;
}

async function callGroq(messages, env) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.GROQ_API_KEY
    },
    body: JSON.stringify({
      model: MODEL,
      messages: messages,
      max_tokens: 3000,
      temperature: 0.5
    })
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text: text };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

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
      return json({ status: 'ok', model: MODEL, provider: 'groq', search: !!env.TAVILY_API_KEY });
    }

    if (request.method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: { message: 'invalid json' } }, 400); }

    let messages = Array.isArray(body.messages) ? body.messages : [];
    messages = messages.filter(function (m) { return m && m.role !== 'system'; }).slice(-MAX_MESSAGES);
    messages = messages
      .filter(function (m) { return (m.content || '').length <= MAX_CHARS; })
      .map(function (m) {
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, MAX_CHARS)
        };
      });

    if (!messages.length) return json({ error: { message: 'no messages' } }, 400);

    const lastUser = messages.slice().reverse().find(function (m) { return m.role === 'user'; });
    const userText = lastUser ? lastUser.content : '';

    let searchContext = '';
    if (liveRe.test(userText)) {
      if (weatherRe.test(userText)) searchContext = await getWeather(userText);
      if (!searchContext && factRe.test(userText)) searchContext = await getWiki(userText);
      if (!searchContext) searchContext = await searchTavily(userText, env);
    }

    const systemPrompt = buildSystemPrompt(searchContext);
    const finalMessages = [{ role: 'system', content: systemPrompt }].concat(messages);

    const result = await callGroq(finalMessages, env);

    return new Response(result.text, {
      status: result.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
