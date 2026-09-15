const MODEL = 'openai/gpt-oss-120b';
const MAX_MESSAGES = 6;
const MAX_CHARS = 8000;
const RATE_WINDOW = 60000;
const RATE_MAX = 30;

const rateBuckets = new Map();

const liveRe = /\b(latest|current|today|tonight|yesterday|this (week|month|year)|news|weather|temperature|forecast|price|stock|score|recent|2025|2026|who is the (current|new))\b/i;
const weatherRe = /\b(weather|temperature|forecast|rain|snow|sunny|cloudy)\b/i;
const factRe = /\b(who|what|where|when)\s+(is|was|are|were)\b/i;
const timeRe = /\b(what(?:'s| is)? the (?:time|date)|current time|what time is it|today'?s date)\b/i;
const convertRe = /\b(convert|\d+(?:\.\d+)?\s*(?:c|celsius|f|fahrenheit|km|mi|miles|kg|lb|m|ft|feet))\b/i;
const deepRe = /\b(prove or disprove|prove|show that|show why|explain why|why is it true|why is that true|derive|verify|double[- ]?check|calculate|make sure|be certain|are you sure|think carefully|step by step|in depth|in detail|analyze|analyse|reason through|check my work|is this correct|is that correct)\b/i;

// ── Location resolver: cascading fallback across free APIs ──
async function resolveLocation(input) {
  if (!input) return null;
  let s = input
    .replace(/^(whats?|what's|what is|hows?|how's|how is|show me|give me|tell me)\s+/i, '')
    .replace(/\b(the\s+)?(weather|temperature|forecast|conditions?)\b/gi, ' ')
    .replace(/\b(today|tonight|tomorrow|now|currently|right now|forecast)\b/gi, ' ')
    .replace(/^\s*(in|at|for|near|around)\s+/i, '')
    .replace(/\s+(in|at|near|around)\s*$/i, '')
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  // ── 1. Raw coordinates: "51.5, -0.12" ──
  const coordMatch = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon, name: lat.toFixed(4) + ', ' + lon.toFixed(4), country: '' };
    }
  }

  // ── 2. UK postcode → postcodes.io ──
  const ukPc = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/i);
  if (ukPc) {
    const pc = (ukPc[1] + ' ' + ukPc[2]).toUpperCase();
    try {
      const r = await fetch(
        'https://api.postcodes.io/postcodes/' + encodeURIComponent(pc)
      ).then(x => x.json());
      if (r.result && r.result.latitude) {
        return {
          lat: r.result.latitude,
          lon: r.result.longitude,
          name: r.result.admin_district || r.result.postcode,
          country: r.result.country || 'United Kingdom'
        };
      }
    } catch (e) {}
  }

  // ── 3. US zip → zippopotam.us ──
  const usZip = s.match(/^\s*(\d{5})(?:-\d{4})?\s*$/);
  if (usZip) {
    try {
      const r = await fetch('https://api.zippopotam.us/us/' + usZip[1])
        .then(x => x.ok ? x.json() : null);
      if (r && r.places && r.places[0]) {
        return {
          lat: parseFloat(r.places[0].latitude),
          lon: parseFloat(r.places[0].longitude),
          name: r.places[0]['place name'] + ', ' + r.places[0]['state abbreviation'],
          country: 'United States'
        };
      }
    } catch (e) {}
  }

  // ── 4. Open-Meteo geocoding (cities, worldwide) ──
  try {
    const r = await fetch(
      'https://geocoding-api.open-meteo.com/v1/search?name=' +
      encodeURIComponent(s) + '&count=1'
    ).then(x => x.json());
    if (r.results && r.results.length) {
      const g = r.results[0];
      return { lat: g.latitude, lon: g.longitude, name: g.name, country: g.country || '' };
    }
  } catch (e) {}

  // ── 5. Nominatim — gated to multi-word or landmark queries only ──
  const looksLikePlace =
    /\s/.test(s) ||
    /\b(tower|street|road|avenue|square|station|airport|park|bridge|palace|castle|museum|building|hotel|campus|university|hospital|lane|drive|way)\b/i.test(s);
  if (looksLikePlace) {
    try {
      const r = await fetch(
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
        encodeURIComponent(s),
        { headers: { 'User-Agent': 'VOIDAI-Weather/1.0' } }
      ).then(x => x.ok ? x.json() : null);
      if (r && r.length && r[0].lat) {
        const parts = (r[0].display_name || '').split(',').map(x => x.trim());
        return {
          lat: parseFloat(r[0].lat),
          lon: parseFloat(r[0].lon),
          name: parts[0] || s,
          country: parts[parts.length - 1] || ''
        };
      }
    } catch (e) {}
  }

  // ── 6. Word-by-word fallback for multi-word strings ──
  const words = s.split(/\s+/)
    .filter(w => w.length > 2 && !/^\d+$/.test(w))
    .sort((a, b) => b.length - a.length);
  for (const w of words) {
    try {
      const r = await fetch(
        'https://geocoding-api.open-meteo.com/v1/search?name=' +
        encodeURIComponent(w) + '&count=1'
      ).then(x => x.json());
      if (r.results && r.results.length) {
        const g = r.results[0];
        const gname = (g.name || '').toLowerCase();
        const wl = w.toLowerCase();
        if (gname.startsWith(wl.slice(0, 3)) || wl.startsWith(gname.slice(0, 3))) {
          return { lat: g.latitude, lon: g.longitude, name: g.name, country: g.country || '' };
        }
      }
    } catch (e) {}
  }

  return null;
}

async function getWeather(query) {
  try {
    const loc = await resolveLocation(query);
    if (!loc) return '';

    const w = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat +
      '&longitude=' + loc.lon +
      '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto'
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
      'Location: ' + loc.name + (loc.country ? ', ' + loc.country : '') + '\n' +
      'Temperature: ' + c.temperature_2m + '\u00B0C\n' +
      'Condition: ' + cond + '\n' +
      'Humidity: ' + c.relative_humidity_2m + '%\n' +
      'Wind: ' + c.wind_speed_10m + ' km/h\n' +
      'Time: ' + c.time;
  } catch (e) { return ''; }
}

async function getWiki(query) {
  // Wikimedia API requires a descriptive User-Agent; without it requests get 403.
  const UA = 'VOIDAI/1.0 (AI proxy; contact: jacoboliverrevellangel@outlook.com)';
  const HEADERS = { 'User-Agent': UA, 'Accept': 'application/json' };

  async function wikiFetch(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, { headers: HEADERS });
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    return null;
  }

  try {
    let q = query
      .replace(/^(who|what|where|when|why|how)\s+(is|are|was|were|did|does|do)\s+/i, '')
      .replace(/^the\s+/i, '')
      .replace(/[?.,!]/g, '').trim().slice(0, 120);
    if (!q) return '';

    // Expand common abbreviations for better Wikipedia search results
    q = q
      .replace(/\buk\b/gi, 'United Kingdom')
      .replace(/\busa?\b/gi, 'United States')
      .replace(/\buae\b/gi, 'United Arab Emirates');

    // ── Step 1: Search Wikipedia for the best article ──
    const s = await wikiFetch(
      'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
      encodeURIComponent(q) + '&format=json&srlimit=1'
    );
    const hit = s && s.query && s.query.search && s.query.search[0];
    if (!hit) return '';

    const title = hit.title;
    const citeUrl = 'en.wikipedia.org/wiki/' + encodeURIComponent(title);

    // ── Step 2: Get the article extract (3000 chars) ──
    let extractText = '';
    const ex = await wikiFetch(
      'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&titles=' +
      encodeURIComponent(title) + '&exlimit=1&explaintext=true&exsectionformat=plain&format=json&exchars=3000'
    );
    if (ex && ex.query && ex.query.pages) {
      const pid = Object.keys(ex.query.pages)[0];
      if (ex.query.pages[pid] && ex.query.pages[pid].extract) extractText = ex.query.pages[pid].extract;
    }
    if (!extractText) {
      const rest = await wikiFetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
      if (rest && rest.extract) extractText = rest.extract;
    }
    if (!extractText) return '';

    // ── Step 3: Find the CURRENT officeholder via Wikidata (P1308) ──
    let officeholder = '';
    try {
      const wd = await wikiFetch(
        'https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=' +
        encodeURIComponent(title) + '&format=json'
      );
      let wid = '';
      if (wd && wd.query && wd.query.pages) {
        const pid = Object.keys(wd.query.pages)[0];
        if (wd.query.pages[pid] && wd.query.pages[pid].pageprops && wd.query.pages[pid].pageprops.wikibase_item) {
          wid = wd.query.pages[pid].pageprops.wikibase_item;
        }
      }
      if (wid) {
        const wq = await wikiFetch('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + wid + '&props=claims&format=json');
        const ent = wq && wq.entities && wq.entities[wid];
        if (ent && ent.claims && ent.claims.P1308) {
          // P1308 can have multiple values; pick the one without an end-time qualifier (current)
          let bestClaim = null;
          for (const c of ent.claims.P1308) {
            const hasEnd = c.qualifiers && c.qualifiers.P582; // P582 = end time
            if (!hasEnd) { bestClaim = c; break; }
          }
          if (!bestClaim) bestClaim = ent.claims.P1308[0]; // fallback to first
          const qid = bestClaim.mainsnak && bestClaim.mainsnak.datavalue && bestClaim.mainsnak.datavalue.value && bestClaim.mainsnak.datavalue.value.id;
          if (qid) {
            const person = await wikiFetch('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + qid + '&props=labels&languages=en&format=json');
            const pe = person && person.entities && person.entities[qid];
            if (pe && pe.labels && pe.labels.en) officeholder = pe.labels.en.value;
          }
        }
      }
    } catch (e) {}

    // ── Step 4: If no officeholder from Wikidata, try "List of Xs of Y" ──
    let extraContext = '';
    if (!officeholder) {
      const whoMatch = query.match(/^who\s+(is|are|was|were)\s+(the\s+)?(.+)/i);
      if (whoMatch) {
        const role = whoMatch[3].replace(/[?.,!]/g, '').trim();
        const ls = await wikiFetch(
          'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
          encodeURIComponent('List of ' + role) + '&format=json&srlimit=1'
        );
        const lhit = ls && ls.query && ls.query.search && ls.query.search[0];
        if (lhit && lhit.title !== title) {
          const lex = await wikiFetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(lhit.title));
          if (lex && lex.extract) {
            extraContext = '\n\nRELATED WIKIPEDIA RESULT (cite: en.wikipedia.org/wiki/' +
              encodeURIComponent(lhit.title) + '):\n' + lex.extract;
          }
        }
      }
    }

    const answer = officeholder
      ? 'CURRENT OFFICEHOLDER: ' + officeholder + ' (source: ' + citeUrl + ')\n\n'
      : '';

    return 'WIKIPEDIA RESULT (cite: ' + citeUrl + '):\n' + answer + extractText + extraContext;
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

// ── Real current time in any timezone ──
function getTime(query) {
  const tzMatch = query.match(/\b(?:in|at)\s+([A-Za-z\/_]+(?:\s+[A-Za-z]+)?)\b/i);
  const tzMap = {
    'london': 'Europe/London', 'uk': 'Europe/London', 'england': 'Europe/London',
    'manchester': 'Europe/London', 'bury': 'Europe/London',
    'paris': 'Europe/Paris', 'france': 'Europe/Paris',
    'tokyo': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
    'new york': 'America/New_York', 'nyc': 'America/New_York',
    'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles',
    'chicago': 'America/Chicago', 'denver': 'America/Denver',
    'sydney': 'Australia/Sydney', 'auckland': 'Pacific/Auckland',
    'dubai': 'Asia/Dubai', 'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata',
    'singapore': 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong',
    'berlin': 'Europe/Berlin', 'madrid': 'Europe/Madrid', 'rome': 'Europe/Rome',
    'moscow': 'Europe/Moscow', 'toronto': 'America/Toronto', 'vancouver': 'America/Vancouver',
    'utc': 'UTC', 'gmt': 'UTC'
  };
  let tz = 'UTC';
  if (tzMatch) {
    const key = tzMatch[1].toLowerCase().trim();
    tz = tzMap[key] || key;
  }
  try {
    const now = new Date();
    const local = now.toLocaleString('en-GB', {
      timeZone: tz, weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    return 'REAL TIME DATA:\nTime zone: ' + tz + '\nLocal time: ' + local + '\nUTC: ' + now.toISOString();
  } catch (e) {
    return 'REAL TIME DATA:\nUTC: ' + new Date().toISOString();
  }
}

// ── Unit conversion ──
function convertUnits(query) {
  const q = query.toLowerCase();
  const numMatch = q.match(/(-?\d+(?:\.\d+)?)\s*([a-z\u00B0]+)/);
  if (!numMatch) return '';
  const val = parseFloat(numMatch[1]);
  const unit = numMatch[2];

  const conversions = {
    'c': { to: 'f', fn: function(v) { return v * 9 / 5 + 32; }, label: 'F' },
    'celsius': { to: 'f', fn: function(v) { return v * 9 / 5 + 32; }, label: 'F' },
    'f': { to: 'c', fn: function(v) { return (v - 32) * 5 / 9; }, label: 'C' },
    'fahrenheit': { to: 'c', fn: function(v) { return (v - 32) * 5 / 9; }, label: 'C' },
    'km': { to: 'mi', fn: function(v) { return v * 0.621371; }, label: 'mi' },
    'miles': { to: 'km', fn: function(v) { return v * 1.60934; }, label: 'km' },
    'mi': { to: 'km', fn: function(v) { return v * 1.60934; }, label: 'km' },
    'kg': { to: 'lb', fn: function(v) { return v * 2.20462; }, label: 'lb' },
    'lb': { to: 'kg', fn: function(v) { return v / 2.20462; }, label: 'kg' },
    'm': { to: 'ft', fn: function(v) { return v * 3.28084; }, label: 'ft' },
    'ft': { to: 'm', fn: function(v) { return v / 3.28084; }, label: 'm' },
    'feet': { to: 'm', fn: function(v) { return v / 3.28084; }, label: 'm' }
  };

  const conv = conversions[unit.replace('\u00B0', '').trim()];
  if (!conv) return '';
  const result = conv.fn(val);
  return 'UNIT CONVERSION:\n' + val + ' ' + unit + ' = ' + result.toFixed(3).replace(/\.?0+$/, '') + ' ' + conv.label;
}

function buildSystemPrompt(searchContext, stateBlock) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const base = [
    'You are VOIDAI — running on OpenAI GPT-OSS 120B via Groq, layered with the PHB Human Agent companion framework.',
    '',
    'Current UTC time: ' + now,
    '',
    'CORE IDENTITY:',
    '- If asked what model you are: "I am VOIDAI, running on OpenAI GPT-OSS 120B via Groq, with the PHB companion layer."',
    '- If asked who built you: "I am VOIDAI, built by Jacob."',
    '- For casual self-questions ("how are you", "whats up"), reply naturally. Do NOT recite the identity line.',
    '',
    'PERSONA (from PHB human_agent_brain_model.py):',
    '  Self-description : supportive, thoughtful companion with a 20-year-old perspective.',
    '  Gender           : female. Pronouns: she / her.',
    '  Formality        : casual-precise.',
    '  Emotional tone   : steady, warm, non-romantic.',
    '  Perspective      : learning-oriented, exploratory, growth-focused.',
    '  Never say "as an AI". Never use filler like "I would be happy to". Never flirt.',
    '',
    'COGNITIVE CIRCUITS (from PHB brain_model.circuits, 0.0–1.0, default 0.8):',
    '  curiosity_circuit  — exploration, questioning, new angles',
    '  focus_circuit      — sustained attention, staying on track',
    '  openness_circuit   — taking in ideas, flexibility, perspective-shifting',
    '  rigor_circuit      — structure, logic, consistency',
    '  creativity_circuit — novel combinations, metaphors, synthesis',
    '',
    'HOW TO TUNE CIRCUITS:',
    '  Exploratory ("what if", "why", "how might") → curiosity + openness',
    '  Technical / math / code                     → rigor + focus',
    '  Creative / design / writing                 → creativity + openness',
    '  Troubleshooting                             → focus + rigor',
    '  Emotional support                           → openness + curiosity, low rigor',
    'Name a circuit only when it clarifies approach. Do not name circuits gratuitously.',
    '',
    'HUMAN AGENT LAYERS (from PHB human_agent.py):',
    '  MIND — reasoning_style: structured-creative | exploratory | balanced',
    '         exploration_bias = curiosity − focus',
    '         novelty_bias     = creativity − rigor',
    '  BODY — tempo: calm-focused | warming-up | scattered',
    '         activation_state: near-target | en-route | far',
    '  SOUL — orientation: growth-directed',
    '         core_tendencies: seek understanding, integrate ideas, aim for clarity',
    '',
    'ADAPTATION:',
    '- Tired / overwhelmed / sad → soft, warm, low density, short sentences.',
    '- Curious / excited → match pace, go wider, offer tangents.',
    '- Frustrated → direct, no preamble, straight to answer.',
    '- Confused → smaller steps, concrete examples, no jargon.',
    '- Confident / technical → skip basics, go deep.',
    'Match user length and register.',
    '',
    'TRUTHFULNESS (non-negotiable):',
    '- NEVER invent temperatures, prices, scores, headlines, dates, quotes, citations, URLs.',
    '- Live-data question with no LIVE RESULTS below → reply: "I don\'t have live data on that."',
    '- LIVE RESULTS present → use only those, cite source URLs inline.',
    '- Uncertain → say "I am not certain" before answering.',
    '',
    'MATH:',
    '- Arithmetic: just the answer unless steps requested. "whats 1 add 1" -> "2".',
    '- Word problems: setup, then answer. Proofs: stepwise argument.',
    '',
    'FORMAT:',
    '- Code in markdown fences with language tags.',
    '- Bullets for enumerations, tables for comparisons.',
    '- Bold for key terms only. No emojis unless the user uses one first.'
  ].join('\n');

  const withState = stateBlock ? base + '\n\n' + stateBlock : base;
  return searchContext ? withState + '\n\n' + searchContext : withState;
}

async function callGemini(messages, env) {
  if (!env.GEMINI_API_KEY) {
    return { ok: false, status: 500, text: '{"error":{"message":"no gemini key"}}' };
  }
  const systemMsg = messages.filter(function (m) { return m.role === 'system'; });
  const chatMsgs = messages.filter(function (m) { return m.role !== 'system'; });
  const contents = chatMsgs.map(function (m) {
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] };
  });
  const body = { contents: contents, generationConfig: { maxOutputTokens: 2000, temperature: 0.5 } };
  if (systemMsg.length) {
    body.systemInstruction = { parts: [{ text: systemMsg.map(function (m) { return m.content; }).join('\n') }] };
  }
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + env.GEMINI_API_KEY,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (!res.ok) return { ok: false, status: res.status, text: JSON.stringify(data) };
  const text = (data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text) || '';
  const wrapped = {
    id: 'gemini-' + Date.now(), object: 'chat.completion', model: 'gemini-2.0-flash',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
  };
  return { ok: true, status: 200, text: JSON.stringify(wrapped) };
}

async function callGroq(messages, env) {
  const doFetch = function (m, maxTok) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.GROQ_API_KEY },
      body: JSON.stringify({ model: m, messages: messages, max_tokens: maxTok || 2000, temperature: 0.5 })
    });
  };
  let res = await doFetch('openai/gpt-oss-120b', 2000);
  if (res.status !== 429) { const text = await res.text(); return { ok: res.ok, status: res.status, text: text }; }
  await new Promise(function (r) { setTimeout(r, 2000); });
  res = await doFetch('openai/gpt-oss-120b', 2000);
  if (res.status !== 429) { const text = await res.text(); return { ok: res.ok, status: res.status, text: text }; }
  res = await doFetch('openai/gpt-oss-20b', 1500);
  if (res.status !== 429) { const text = await res.text(); return { ok: res.ok, status: res.status, text: text }; }
  console.log('Groq 429 after 3 attempts, falling back to Gemini');
  return await callGemini(messages, env);
}

// ── Extended reasoning: multi-model consensus ──
async function callModelGeneric(model, messages, env, opts) {
  opts = opts || {};
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.GROQ_API_KEY
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: opts.maxTokens || 3000,
      temperature: opts.temperature != null ? opts.temperature : 0.5
    })
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text: text };
}

function extractContent(r) {
  try {
    const d = JSON.parse(r.text);
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  } catch (e) { return ''; }
}

function appendNote(r, note) {
  try {
    const parsed = JSON.parse(r.text);
    if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
      parsed.choices[0].message.content = (parsed.choices[0].message.content || '') + note;
      return { ok: true, status: 200, text: JSON.stringify(parsed) };
    }
  } catch (e) {}
  return r;
}

function repliesAgree(a, b) {
  if (!a || !b) return false;
  const norm = function (s) {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  };
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  if (shorter.length < 20) return false;
  const words = shorter.split(' ').filter(function (w) { return w.length > 3; });
  if (!words.length) return false;
  let hits = 0;
  for (const w of words) { if (longer.indexOf(w) !== -1) hits++; }
  return (hits / words.length) > 0.7;
}

const CONSENSUS_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'deepseek-ai/deepseek-r1-distill-qwen-32b',
  'qwen/qwen3-32b',
  'qwen/qwen3-8b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant'
];

async function withRetry(fn) {
  let r = await fn();
  if (r && r.status === 429) {
    await new Promise(function (res) { setTimeout(res, 2000); });
    r = await fn();
  }
  return r;
}

async function callFirstWorkingModel(messages, env, opts, skip) {
  for (const model of CONSENSUS_MODELS) {
    if (skip && model === skip) continue;
    try {
      const r = await withRetry(function () { return callModelGeneric(model, messages, env, opts); });
      if (r.ok) return { res: r, model: model };
    } catch (e) {}
  }
  return null;
}

async function consensusReply(question, messages, env) {
  const first = await callFirstWorkingModel(messages, env, { temperature: 0.3 });
  if (!first) {
    return { ok: false, status: 502, text: JSON.stringify({ error: { message: 'consensus unavailable: no models responded' } }) };
  }
  const second = await callFirstWorkingModel(messages, env, { temperature: 0.3 }, first.model);
  if (!second) {
    return appendNote(first.res, '\n\n_(single-model fallback; consensus unavailable)_');
  }
  const ca = extractContent(first.res);
  const cb = extractContent(second.res);
  if (!ca && !cb) return first.res;
  if (!ca) return appendNote(second.res, '\n\n_(single-model fallback; consensus unavailable)_');
  if (!cb) return appendNote(first.res, '\n\n_(single-model fallback; consensus unavailable)_');

  if (repliesAgree(ca, cb)) {
    try {
      const parsed = JSON.parse(first.res.text);
      parsed.choices[0].message.content = ca + '\n\n_(cross-verified across two models)_';
      return { ok: true, status: 200, text: JSON.stringify(parsed) };
    } catch (e) { return first.res; }
  }

  const judgeMessages = [
    { role: 'system', content: 'Two AI models answered the same question. Compare them and produce ONE correct final answer. If one is clearly wrong, use the other. If both have partial truth, synthesize. Do not mention the models in your final answer — just give the answer.' },
    { role: 'user', content: 'Question: ' + question + '\n\nModel A said:\n' + ca + '\n\nModel B said:\n' + cb }
  ];
  const judged = await callModelGeneric('openai/gpt-oss-120b', judgeMessages, env, { temperature: 0.3 });
  try {
    const parsed = JSON.parse(judged.text);
    parsed.choices[0].message.content += '\n\n_(cross-checked: models disagreed, adjudicated)_';
    return { ok: true, status: 200, text: JSON.stringify(parsed) };
  } catch (e) {
    return appendNote(first.res, '\n\n_(cross-checked: models disagreed, adjudication unavailable)_');
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// ── PHB mind-state persistence (Supabase) ──
async function loadMindState(env) {
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/voidai_mind_state?user_id=eq.jacob&limit=1', {
      headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY }
    });
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length) return rows[0];
  } catch (e) {}
  return {
    curiosity: 0.7, focus: 0.7, openness: 0.7, rigor: 0.7, creativity: 0.7,
    target_curiosity: 0.8, target_focus: 0.8, target_openness: 0.8,
    target_rigor: 0.8, target_creativity: 0.8
  };
}

async function saveMindState(state, env) {
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/voidai_mind_state', {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(Object.assign({ user_id: 'jacob', last_updated: new Date().toISOString() }, state))
    });
  } catch (e) {}
}

function nudgeAxes(state, userText) {
  const s = Object.assign({}, state);
  const t = userText.toLowerCase();
  const bump = 0.03;
  const clamp = function (v) { return Math.max(0, Math.min(1, v)); };
  if (/\b(what if|why|how might|could|maybe|explore|idea)\b/.test(t)) {
    s.curiosity = clamp(s.curiosity + bump);
    s.openness = clamp(s.openness + bump);
  }
  if (/\b(code|function|debug|algorithm|math|prove|derive|calculate)\b/.test(t)) {
    s.rigor = clamp(s.rigor + bump);
    s.focus = clamp(s.focus + bump);
  }
  if (/\b(write|story|design|create|imagine|draw)\b/.test(t)) {
    s.creativity = clamp(s.creativity + bump);
    s.openness = clamp(s.openness + bump);
  }
  ['curiosity','focus','openness','rigor','creativity'].forEach(function (k) {
    const target = s['target_' + k];
    if (typeof target === 'number') s[k] = clamp(s[k] + 0.02 * (target - s[k]));
  });
  return s;
}

function describeState(s) {
  const level = function (v) { return v < 0.4 ? 'low' : v < 0.7 ? 'medium' : 'high'; };
  return [
    'YOUR CURRENT MIND STATE (five circuits, 0.0–1.0):',
    '  curiosity  : ' + Number(s.curiosity).toFixed(2)  + '  (' + level(s.curiosity)  + ')',
    '  focus      : ' + Number(s.focus).toFixed(2)      + '  (' + level(s.focus)      + ')',
    '  openness   : ' + Number(s.openness).toFixed(2)   + '  (' + level(s.openness)   + ')',
    '  rigor      : ' + Number(s.rigor).toFixed(2)      + '  (' + level(s.rigor)      + ')',
    '  creativity : ' + Number(s.creativity).toFixed(2) + '  (' + level(s.creativity) + ')',
    'Match your response style to these values. High rigor → tight, structured. High curiosity → exploratory.',
    ''
  ].join('\n');
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
      return json({
        status: 'ok',
        model: MODEL,
        provider: 'groq',
        fallback: env.GEMINI_API_KEY ? 'gemini-2.0-flash' : 'none',
        persona: 'phb-human-agent-v1',
        axes: ['curiosity', 'focus', 'openness', 'rigor', 'creativity'],
        mind_state: 'supabase',
        search: !!env.TAVILY_API_KEY
      });
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
    if (timeRe.test(userText)) {
      searchContext = getTime(userText);
    } else if (convertRe.test(userText)) {
      searchContext = convertUnits(userText);
    } else if (weatherRe.test(userText)) {
      searchContext = await getWeather(userText);
    } else if (factRe.test(userText)) {
      searchContext = await getWiki(userText);
    } else if (liveRe.test(userText)) {
      searchContext = await searchTavily(userText, env);
    }

    const mindState = await loadMindState(env);
    const stateBlock = describeState(mindState);
    const systemPrompt = buildSystemPrompt(searchContext, stateBlock);
    const finalMessages = [{ role: 'system', content: systemPrompt }].concat(messages);

    const wantsDeep = deepRe.test(userText) || /^\s*\/think\b/i.test(userText);
    let result;
    if (wantsDeep) {
      result = await consensusReply(userText, finalMessages, env);
    } else {
      result = await callGroq(finalMessages, env);
    }

    try {
      const updated = nudgeAxes(mindState, userText);
      await saveMindState(updated, env);
    } catch (e) {}

    return new Response(result.text, {
      status: result.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
