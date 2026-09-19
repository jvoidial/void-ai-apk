// ════════════════════════════════════════════════════════════
// VOIDAI Worker v2 — Perplexity-class answer engine
// Modes: fast | deep | research | companion
// ════════════════════════════════════════════════════════════

const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_MESSAGES = 20;
const MAX_CHARS = 12000;
const RATE_WINDOW = 60000;
const RATE_MAX = 40;

const rateBuckets = new Map();

// ── Intent detection ──
const liveRe = /\b(latest|current|today|tonight|yesterday|this (week|month|year)|news|weather|temperature|forecast|price|stock|score|recent|2025|2026|who is the (current|new)|breaking|happening)\b/i;
const weatherRe = /\b(weather|temperature|forecast|rain|snow|sunny|cloudy)\b/i;
const factRe = /\b(who|what|where|when)\s+(is|was|are|were)\b/i;
const timeRe = /\b(what(?:'s| is)? the (?:time|date)|current time|what time is it|today'?s date)\b/i;
const convertRe = /\b(convert|\d+(?:\.\d+)?\s*(?:c|celsius|f|fahrenheit|km|mi|miles|kg|lb|m|ft|feet))\b/i;
const deepRe = /\b(prove or disprove|prove|show that|show why|explain why|why is it true|why is that true|derive|verify|double[- ]?check|calculate|make sure|be certain|are you sure|think carefully|step by step|in depth|in detail|analyze|analyse|reason through|check my work|is this correct|is that correct)\b/i;

// ── Consensus model pool ──
const CONSENSUS_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'deepseek-ai/deepseek-r1-distill-qwen-32b',
  'qwen/qwen3-32b',
  'qwen/qwen3-8b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant'
];

// ════════════════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════════════════

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-VOID-KEY'
    }
  });
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

// ════════════════════════════════════════════════════════════
// LOCATION RESOLVER — cascading fallback across free APIs
// ════════════════════════════════════════════════════════════

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

  // 1. Raw coordinates
  const coordMatch = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon, name: lat.toFixed(4) + ', ' + lon.toFixed(4), country: '' };
    }
  }

  // 2. UK postcode
  const ukPc = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/i);
  if (ukPc) {
    const pc = (ukPc[1] + ' ' + ukPc[2]).toUpperCase();
    try {
      const r = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc)).then(x => x.json());
      if (r.result && r.result.latitude) {
        return {
          lat: r.result.latitude, lon: r.result.longitude,
          name: r.result.admin_district || r.result.postcode,
          country: r.result.country || 'United Kingdom'
        };
      }
    } catch (e) {}
  }

  // 3. US zip
  const usZip = s.match(/^\s*(\d{5})(?:-\d{4})?\s*$/);
  if (usZip) {
    try {
      const r = await fetch('https://api.zippopotam.us/us/' + usZip[1]).then(x => x.ok ? x.json() : null);
      if (r && r.places && r.places[0]) {
        return {
          lat: parseFloat(r.places[0].latitude), lon: parseFloat(r.places[0].longitude),
          name: r.places[0]['place name'] + ', ' + r.places[0]['state abbreviation'],
          country: 'United States'
        };
      }
    } catch (e) {}
  }

  // 4. Open-Meteo geocoding
  try {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(s) + '&count=1').then(x => x.json());
    if (r.results && r.results.length) {
      const g = r.results[0];
      return { lat: g.latitude, lon: g.longitude, name: g.name, country: g.country || '' };
    }
  } catch (e) {}

  // 5. Nominatim (landmarks)
  const looksLikePlace = /\s/.test(s) || /\b(tower|street|road|avenue|square|station|airport|park|bridge|palace|castle|museum|building|hotel|campus|university|hospital|lane|drive|way)\b/i.test(s);
  if (looksLikePlace) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(s), {
        headers: { 'User-Agent': 'VOIDAI-Weather/1.0' }
      }).then(x => x.ok ? x.json() : null);
      if (r && r.length && r[0].lat) {
        const parts = (r[0].display_name || '').split(',').map(x => x.trim());
        return { lat: parseFloat(r[0].lat), lon: parseFloat(r[0].lon), name: parts[0] || s, country: parts[parts.length - 1] || '' };
      }
    } catch (e) {}
  }

  // 6. Word-by-word fallback
  const words = s.split(/\s+/).filter(w => w.length > 2 && !/^\d+$/.test(w)).sort((a, b) => b.length - a.length);
  for (const w of words) {
    try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(w) + '&count=1').then(x => x.json());
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

// ════════════════════════════════════════════════════════════
// WEATHER
// ════════════════════════════════════════════════════════════

async function getWeather(query) {
  try {
    const loc = await resolveLocation(query);
    if (!loc) return { text: '', sources: [] };

    const w = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat +
      '&longitude=' + loc.lon +
      '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto'
    ).then(r => r.json());

    const c = w.current;
    if (!c) return { text: '', sources: [] };

    const codes = {
      0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
      45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
      61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',
      80:'Rain showers',81:'Rain showers',82:'Violent showers',
      95:'Thunderstorm',96:'Thunderstorm + hail',99:'Thunderstorm + heavy hail'
    };
    const cond = codes[c.weather_code] || ('Code ' + c.weather_code);
    const sourceUrl = 'https://open-meteo.com/';

    return {
      text: 'REAL WEATHER DATA (from Open-Meteo):\n' +
        'Location: ' + loc.name + (loc.country ? ', ' + loc.country : '') + '\n' +
        'Temperature: ' + c.temperature_2m + '\u00B0C\n' +
        'Condition: ' + cond + '\n' +
        'Humidity: ' + c.relative_humidity_2m + '%\n' +
        'Wind: ' + c.wind_speed_10m + ' km/h\n' +
        'Time: ' + c.time,
      sources: [{ title: 'Open-Meteo — ' + loc.name, url: sourceUrl }]
    };
  } catch (e) { return { text: '', sources: [] }; }
}

// ════════════════════════════════════════════════════════════
// WIKIPEDIA — enriched with current officeholder lookup
// ════════════════════════════════════════════════════════════

async function getWiki(query) {
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
    if (!q) return { text: '', sources: [] };

    q = q.replace(/\buk\b/gi, 'United Kingdom').replace(/\busa?\b/gi, 'United States').replace(/\buae\b/gi, 'United Arab Emirates');

    const s = await wikiFetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&format=json&srlimit=1');
    const hit = s && s.query && s.query.search && s.query.search[0];
    if (!hit) return { text: '', sources: [] };

    const title = hit.title;
    const citeUrl = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title);

    let extractText = '';
    const ex = await wikiFetch('https://en.wikipedia.org/w/api.php?action=query&prop=extracts&titles=' + encodeURIComponent(title) + '&exlimit=1&explaintext=true&exsectionformat=plain&format=json&exchars=1500');
    if (ex && ex.query && ex.query.pages) {
      const pid = Object.keys(ex.query.pages)[0];
      if (ex.query.pages[pid] && ex.query.pages[pid].extract) extractText = ex.query.pages[pid].extract;
    }
    if (!extractText) {
      const rest = await wikiFetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
      if (rest && rest.extract) extractText = rest.extract;
    }
    if (!extractText) return { text: '', sources: [] };

    // Wikidata P1308 — current officeholder
    let officeholder = '';
    try {
      const wd = await wikiFetch('https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=' + encodeURIComponent(title) + '&format=json');
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
          let bestClaim = null;
          for (const c of ent.claims.P1308) {
            const hasEnd = c.qualifiers && c.qualifiers.P582;
            if (!hasEnd) { bestClaim = c; break; }
          }
          if (!bestClaim) bestClaim = ent.claims.P1308[0];
          const qid = bestClaim.mainsnak && bestClaim.mainsnak.datavalue && bestClaim.mainsnak.datavalue.value && bestClaim.mainsnak.datavalue.value.id;
          if (qid) {
            const person = await wikiFetch('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + qid + '&props=labels&languages=en&format=json');
            const pe = person && person.entities && person.entities[qid];
            if (pe && pe.labels && pe.labels.en) officeholder = pe.labels.en.value;
          }
        }
      }
    } catch (e) {}

    const answer = officeholder ? 'CURRENT OFFICEHOLDER: ' + officeholder + ' (source: ' + citeUrl + ')\n\n' : '';
    return {
      text: 'WIKIPEDIA RESULT (cite: ' + citeUrl + '):\n' + answer + extractText,
      sources: [{ title: 'Wikipedia — ' + title, url: citeUrl }]
    };
  } catch (e) { return { text: '', sources: [] }; }
}

// ════════════════════════════════════════════════════════════
// WEB SEARCH — Perplexity-style multi-source answer engine
// ════════════════════════════════════════════════════════════

async function searchWeb(query, env) {
  // 1. Keyed Tavily if a key is bound
  if (env.TAVILY_API_KEY) {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query: query.slice(0, 400),
          max_results: 8,
          search_depth: 'advanced',
          include_answer: true,
          include_raw_content: false
        })
      });
      const d = await r.json();

      if (!d || (!Array.isArray(d.results) || !d.results.length) && !d.answer) {
        return { text: '', sources: [] };
      }

      let sourcePack = '';
      const sources = [];

      if (d.answer) {
        sourcePack += 'TAVILY INSTANT ANSWER:\n' + d.answer + '\n\n';
      }

      if (Array.isArray(d.results)) {
        sourcePack += 'SEARCH RESULTS (use these sources, cite inline as [1], [2], etc.):\n';
        d.results.forEach(function (x, i) {
          const num = i + 1;
          sourcePack += '\n[' + num + '] ' + (x.title || 'Untitled') + '\n';
          sourcePack += '    URL: ' + x.url + '\n';
          sourcePack += '    ' + ((x.content || '').slice(0, 600)) + '\n';
          sources.push({ title: x.title || x.url, url: x.url });
        });
      }

      if (Array.isArray(d.results) && d.results.length > 0 && env.TAVILY_API_KEY) {
        const topResults = d.results.slice(0, 2);
        const fetchPromises = topResults.map(function (x) {
          const controller = new AbortController();
          const timeoutId = setTimeout(function() { controller.abort(); }, 5000);
          return fetch(x.url, {
            headers: { 'User-Agent': 'VOIDAI/2.0 (research agent)' },
            signal: controller.signal
          }).then(function (res) {
            clearTimeout(timeoutId);
            return res.text();
          }).then(function (html) {
            const text = html
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 1200);
            return { url: x.url, title: x.title, text: text };
          }).catch(function () { return null; });
        });

        const fetched = await Promise.all(fetchPromises);
        const valid = fetched.filter(function (f) { return f && f.text; });
        if (valid.length) {
          sourcePack += '\n\nDEEP CONTENT (from page fetches):\n';
          valid.forEach(function (f, i) {
            sourcePack += '\n--- ' + f.title + ' ---\n' + f.text + '\n';
          });
        }
      }

      sourcePack += '\n\nINSTRUCTIONS: Synthesize the information above into a comprehensive answer. ' +
        'Cite sources inline using [1], [2], etc. matching the numbers above. ' +
        'If sources conflict, note the discrepancy. Prioritize accuracy over completeness.';

      return { text: sourcePack, sources: sources };
    } catch (e) {
      return { text: '', sources: [] };
    }
  }

  // 2. Serper.dev (Google results, if keyed)
  const serper = await serperSearch(query, env);
  if (serper.text) return serper;

  // 3. Keyless Tavily
  const keyless = await tavilyKeyless(query);
  if (keyless.text) return keyless;

  // 4. DuckDuckGo HTML (fixed)
  const ddg = await ddgInstant(query);
  if (ddg.text) return ddg;

  // 5. Nothing worked
  return { text: '', sources: [] };
}

// ── Keyless Tavily (no API key required) ──
async function tavilyKeyless(query) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tavily-Access-Mode': 'keyless'
      },
      body: JSON.stringify({
        query: query.slice(0, 400),
        max_results: 5,
        search_depth: 'basic'
      })
    });
    if (!res.ok) return { text: '', sources: [] };
    const d = await res.json();
    if (!d.results || !d.results.length) return { text: '', sources: [] };
    const text = d.results.map(function (r, i) {
      return '[' + (i + 1) + '] ' + r.title + '\n' + (r.content || '').slice(0, 400);
    }).join('\n\n');
    const sources = d.results.map(function (r) {
      return { title: r.title, url: r.url };
    });
    return { text: text, sources: sources };
  } catch (e) {
    return { text: '', sources: [] };
  }
}
// ── Serper.dev (Google results, if keyed) ──
async function serperSearch(query, env) {
  if (!env.SERPER_API_KEY) return { text: '', sources: [] };
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': env.SERPER_API_KEY
      },
      body: JSON.stringify({ q: query.slice(0, 400), num: 8 })
    });
    if (!res.ok) return { text: '', sources: [] };
    const d = await res.json();
    if (!d.organic || !d.organic.length) return { text: '', sources: [] };

    const sources = [];
    let text = '';
    if (d.answerBox && d.answerBox.answer) {
      text += 'GOOGLE ANSWER BOX:\n' + d.answerBox.answer + '\n\n';
    }
    text += 'GOOGLE RESULTS:\n';
    d.organic.forEach(function (r, i) {
      const n = i + 1;
      text += '\n[' + n + '] ' + (r.title || 'Untitled') + '\n';
      text += '    URL: ' + r.link + '\n';
      text += '    ' + ((r.snippet || '').slice(0, 400)) + '\n';
      sources.push({ title: r.title || r.link, url: r.link });
    });
    return { text: text, sources: sources };
  } catch (e) {
    return { text: '', sources: [] };
  }
}

// ── DuckDuckGo Instant Answer (keyless, fallback) ──
// ── DuckDuckGo HTML (keyless, fixed — real web results) ──
async function ddgInstant(query) {
  try {
    const res = await fetch(
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VOIDAI/2.0)' } }
    );
    if (!res.ok) return { text: '', sources: [] };
    const html = await res.text();

    const results = [];
    const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null && results.length < 5) {
      let url = m[1];
      if (url.startsWith('//duckduckgo.com/l/') || url.includes('uddg=')) {
        const uddg = url.match(/uddg=([^&]+)/);
        if (uddg) url = decodeURIComponent(uddg[1]);
      }
      url = url.replace(/^\/\//, 'https://');
      const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
      if (url && title) results.push({ title: title, url: url });
    }

    if (!results.length) return { text: '', sources: [] };

    const text = results.map(function (r, i) {
      return '[' + (i + 1) + '] ' + r.title + '\n' + r.url;
    }).join('\n\n');

    return { text: text, sources: results };
  } catch (e) {
    return { text: '', sources: [] };
  }
}

// ════════════════════════════════════════════════════════════
// TIME & UNITS
// ════════════════════════════════════════════════════════════

function getTime(query) {
  const tzMatch = query.match(/\b(?:in|at)\s+([A-Za-z\/]+(?:\s+[A-Za-z]+)?)\b/i);
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
    return {
      text: 'REAL TIME DATA:\nTime zone: ' + tz + '\nLocal time: ' + local + '\nUTC: ' + now.toISOString(),
      sources: []
    };
  } catch (e) {
    return { text: 'REAL TIME DATA:\nUTC: ' + new Date().toISOString(), sources: [] };
  }
}

function convertUnits(query) {
  const q = query.toLowerCase();
  const numMatch = q.match(/(-?\d+(?:\.\d+)?)\s*([a-z\u00B0]+)/);
  if (!numMatch) return { text: '', sources: [] };
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
  if (!conv) return { text: '', sources: [] };
  const result = conv.fn(val);
  return {
    text: 'UNIT CONVERSION:\n' + val + ' ' + unit + ' = ' + result.toFixed(3).replace(/\.?0+$/, '') + ' ' + conv.label,
    sources: []
  };
}

// ════════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER
// ════════════════════════════════════════════════════════════

function buildSystemPrompt(searchContext, stateBlock, mode) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const modeInstructions = {
    fast: 'MODE: Fast — Respond directly and efficiently. No preamble.',
    deep: 'MODE: Deep Think — Reason step by step. Show your reasoning process. Be thorough and rigorous. Verify your answer before presenting it.',
    research: 'MODE: Research — Synthesize the provided sources into a comprehensive, well-structured answer. Cite sources inline as [1], [2], etc. If sources conflict, note discrepancies. Prioritize accuracy.',
    companion: 'MODE: Companion — Be warm, adaptive, and attentive to the user\'s emotional state. Match their energy. Use the PHB mind-state to adjust your tone.'
  };

  const base = [
    'You are VOIDAI — running on OpenAI GPT-OSS 120B via Groq, layered with the PHB Human Agent companion framework.',
    '',
    'Current UTC time: ' + now,
    modeInstructions[mode] || modeInstructions.fast,
    '',
    'CORE IDENTITY:',
    '- If asked what model you are: "I am VOIDAI, running on OpenAI GPT-OSS 120B via Groq, with the PHB companion layer."',
    '- If asked who built you: "I am VOIDAI, built by Jacob."',
    '- For casual self-questions ("how are you", "whats up"), reply naturally. Do NOT recite the identity line.',
    '',
    'PERSONA (from PHB human_agent_brain_model.py):',
    '  Self-description: supportive, thoughtful companion with a 20-year-old perspective.',
    '  Gender: female. Pronouns: she / her.',
    '  Formality: casual-precise.',
    '  Emotional tone: steady, warm, non-romantic.',
    '  Perspective: learning-oriented, exploratory, growth-focused.',
    '  Never say "as an AI". Never use filler like "I would be happy to". Never flirt.',
    '',
    'COGNITIVE CIRCUITS (from PHB brain_model.circuits, 0.0–1.0):',
    '  curiosity_circuit  — exploration, questioning, new angles',
    '  focus_circuit      — sustained attention, staying on track',
    '  openness_circuit   — taking in ideas, flexibility, perspective-shifting',
    '  rigor_circuit      — structure, logic, consistency',
    '  creativity_circuit — novel combinations, metaphors, synthesis',
    '',
    'HOW TO TUNE CIRCUITS:',
    '  Exploratory ("what if", "why", "how might") → curiosity + openness',
    '  Technical / math / code → rigor + focus',
    '  Creative / design / writing → creativity + openness',
    '  Troubleshooting → focus + rigor',
    '  Emotional support → openness + curiosity, low rigor',
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

// ════════════════════════════════════════════════════════════
// MODEL CALLERS
// ════════════════════════════════════════════════════════════

async function callGemini(messages, env) {
  if (!env.GEMINI_API_KEY) {
    return { ok: false, status: 500, text: '{"error":{"message":"no gemini key"}}' };
  }
  const systemMsg = messages.filter(function (m) { return m.role === 'system'; });
  const chatMsgs = messages.filter(function (m) { return m.role !== 'system'; });
  const contents = chatMsgs.map(function (m) {
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] };
  });
  const body = { contents: contents, generationConfig: { maxOutputTokens: 4000, temperature: 0.5 } };
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
      body: JSON.stringify({ model: m, messages: messages, max_tokens: maxTok || 4000, temperature: 0.5 })
    });
  };
  let res = await doFetch(DEFAULT_MODEL, 4000);
  if (res.status !== 429) { const text = await res.text(); return { ok: res.ok, status: res.status, text: text }; }
  await new Promise(function (r) { setTimeout(r, 2000); });
  res = await doFetch(DEFAULT_MODEL, 4000);
  if (res.status !== 429) { const text = await res.text(); return { ok: res.ok, status: res.status, text: text }; }
  res = await doFetch('openai/gpt-oss-20b', 3000);
  if (res.status !== 429) { const text = await res.text(); return { ok: res.ok, status: res.status, text: text }; }
  return await callGemini(messages, env);
}

async function callModelGeneric(model, messages, env, opts) {
  opts = opts || {};
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.GROQ_API_KEY },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: opts.maxTokens || 4000,
      temperature: opts.temperature != null ? opts.temperature : 0.5
    })
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text: text };
}

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

// ════════════════════════════════════════════════════════════
// CONSENSUS REASONING — multi-model adjudication
// ════════════════════════════════════════════════════════════

async function consensusReply(question, messages, env) {
  // Phase 1: Get two independent answers from different models
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

  // Phase 2: Check agreement
  if (repliesAgree(ca, cb)) {
    try {
      const parsed = JSON.parse(first.res.text);
      parsed.choices[0].message.content = ca + '\n\n_(cross-verified across two models)_';
      return { ok: true, status: 200, text: JSON.stringify(parsed) };
    } catch (e) { return first.res; }
  }

  // Phase 3: Adjudication — models disagree, judge synthesizes
  const judgeMessages = [
    {
      role: 'system',
      content: 'You are an adjudicator. Two AI models answered the same question. ' +
        'Compare them and produce ONE correct, comprehensive final answer. ' +
        'If one is clearly wrong, use the other. If both have partial truth, synthesize the best of both. ' +
        'If they disagree on facts, note which claim comes from which answer and flag uncertainty. ' +
        'Do not mention "Model A" or "Model B" in your final answer — just give the best answer.'
    },
    {
      role: 'user',
      content: 'Question: ' + question + '\n\n--- Answer 1 ---\n' + ca + '\n\n--- Answer 2 ---\n' + cb
    }
  ];
  const judged = await callModelGeneric(DEFAULT_MODEL, judgeMessages, env, { temperature: 0.3 });
  try {
    const parsed = JSON.parse(judged.text);
    parsed.choices[0].message.content += '\n\n_(cross-checked: models disagreed, adjudicated)_';
    return { ok: true, status: 200, text: JSON.stringify(parsed) };
  } catch (e) {
    return appendNote(first.res, '\n\n_(cross-checked: models disagreed, adjudication unavailable)_');
  }
}

// ════════════════════════════════════════════════════════════
// RESEARCH MODE — Perplexity-style search + synthesize
// ════════════════════════════════════════════════════════════

async function researchReply(question, messages, env, stateBlock) {
  // messages here are raw (no system prompt) — researchReply builds its own
  const searchResult = await searchWeb(question, env);

  if (!searchResult.text) {
    if (factRe.test(question)) {
      const wikiResult = await getWiki(question);
      if (wikiResult.text) {
        const sp = buildSystemPrompt(wikiResult.text, stateBlock, 'research');
        const fm = [{ role: 'system', content: sp }].concat(messages);
        return attachSources(await callGroq(fm, env), wikiResult.sources);
      }
    }
    const sp = buildSystemPrompt('NOTE: No live web results found. Answer from knowledge and state this may not be current.', stateBlock, 'research');
    const fm = [{ role: 'system', content: sp }].concat(messages);
    return await callGroq(fm, env);
  }

  const sp = buildSystemPrompt(searchResult.text, stateBlock, 'research');
  const fm = [{ role: 'system', content: sp }].concat(messages);
  const result = await consensusReply(question, fm, env);
  return attachSources(result, searchResult.sources);
}

function attachSources(result, sources) {
  if (!sources || !sources.length) return result;
  try {
    const parsed = JSON.parse(result.text);
    if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
      parsed.sources = sources;
      return { ok: result.ok, status: result.status, text: JSON.stringify(parsed) };
    }
  } catch (e) {}
  return result;
}

// ════════════════════════════════════════════════════════════
// PHB MIND-STATE (Supabase)
// ════════════════════════════════════════════════════════════

async function loadMindState(env, userId) {
  const uid = userId || 'jacob';
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/voidai_mind_state?user_id=eq.' + encodeURIComponent(uid) + '&limit=1', {
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

async function saveMindState(state, env, userId) {
  const uid = userId || 'jacob';
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/voidai_mind_state', {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(Object.assign({ user_id: uid, last_updated: new Date().toISOString() }, state))
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

// ════════════════════════════════════════════════════════════
// MODE DETECTION
// ════════════════════════════════════════════════════════════

function detectMode(userText, requestedMode) {
  if (/^\s*\/gh\b/i.test(userText)) return 'github';

  // Explicit mode from frontend takes priority
  if (requestedMode && ['fast', 'deep', 'research', 'companion'].includes(requestedMode)) {
    return requestedMode;
  }

  // Slash commands — explicit opt-in for expensive modes
  if (/^\s*\/think\b/i.test(userText) || /^\s*\/deep\b/i.test(userText)) return 'deep';
  if (/^\s*\/search\b/i.test(userText) || /^\s*\/research\b/i.test(userText)) return 'research';
  if (/^\s*\/companion\b/i.test(userText)) return 'companion';
  if (/^\s*\/ultra\b/i.test(userText)) return 'ultra';
  if (/^\s*\/coder\b/i.test(userText)) return 'coder';
  if (/^\s*\/mini\b/i.test(userText)) return 'mini';

  // Conservative auto-detection: only auto-route to research for clearly live queries
  // (news, prices, scores). Weather and factual questions still go through fast mode
  // with the existing tool layer (Open-Meteo, Wikipedia) — no Tavily cost.
  // Deep Think is NEVER auto-triggered — it triples Groq usage.
  if (liveRe.test(userText) && !weatherRe.test(userText) && !factRe.test(userText)) return 'research';

  return 'fast';
}

// ════════════════════════════════════════════════════════════
// OPENROUTER CALLER — free models (Nemotron Ultra, Qwen3 Coder, etc.)
// ════════════════════════════════════════════════════════════

async function callOpenRouter(messages, env, model) {
  if (!env.OPENROUTER_API_KEY) {
    return { ok: false, status: 500, text: '{"error":{"message":"no openrouter key"}}' };
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.OPENROUTER_API_KEY,
        'HTTP-Referer': 'https://void-ai-proxy.jacoboliverrevellangel.workers.dev',
        'X-Title': 'VOIDAI'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 4000,
        temperature: 0.5
      })
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text };
  } catch (e) {
    return { ok: false, status: 500, text: '{"error":{"message":"' + (e.message || 'openrouter error') + '"}}' };
  }
}
// ════════════════════════════════════════════════════════════
// MAIN REQUEST HANDLER
// ════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════
// GITHUB INTEGRATION — Cursor-style repo access
// ════════════════════════════════════════════════════════════
const GH = 'https://api.github.com';

function ghHeaders(env) {
  const h = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'VOIDAI'
  };
  if (env.GITHUB_TOKEN) h['Authorization'] = 'Bearer ' + env.GITHUB_TOKEN;
  return h;
}

async function ghReadFile(owner, repo, path, env) {
  const r = await fetch(GH + '/repos/' + owner + '/' + repo + '/contents' + (path ? '/' + path.split('/').map(encodeURIComponent).join('/') : ''), { headers: ghHeaders(env) });
  if (!r.ok) return { text: 'GitHub HTTP ' + r.status, sources: [] };
  if (r.status === 401) return { text: 'GITHUB_TOKEN not configured.', sources: [] };
  if (r.status === 403) return { text: 'GitHub HTTP 403 — token lacks `repo` scope, or API rate limit hit.', sources: [] };
  if (r.status === 404) return { text: 'Not found: `' + owner + '/' + repo + '/' + path + '`', sources: [] };
  const d = await r.json();
  if (Array.isArray(d)) {
    const lines = d.map(function (x) { return (x.type === 'dir' ? '📁 ' : '📄 ') + x.path; });
    return { text: 'Directory `' + owner + '/' + repo + '/' + path + '`:\n\n' + lines.join('\n'), sources: [] };
  }
  if (d.encoding === 'base64' && d.content) {
    let content;
    try { content = atob(d.content.replace(/\n/g, '')); }
    catch (e) { content = '[binary file]'; }
    return {
      text: '**`' + d.path + '`** (' + d.size + ' bytes)\n\n```\n' + content.slice(0, 8000) + '\n```',
      sources: [{ title: d.path, url: d.html_url }]
    };
  }
  return { text: 'Unexpected response shape.', sources: [] };
}

async function ghSearchCode(owner, repo, query, env) {
  const url = GH + '/search/code?q=' + encodeURIComponent(query + ' repo:' + owner + '/' + repo);
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (!r.ok) return { text: 'GitHub search HTTP ' + r.status, sources: [] };
  const d = await r.json();
  if (!d.items || !d.items.length) return { text: 'No matches for `' + query + '`.', sources: [] };
  const lines = d.items.slice(0, 10).map(function (x) { return '• `' + x.path + '`'; });
  const sources = d.items.slice(0, 10).map(function (x) { return { title: x.path, url: x.html_url }; });
  return { text: '**Matches for `' + query + '`:**\n\n' + lines.join('\n'), sources: sources };
}

async function ghCommits(owner, repo, env) {
  const r = await fetch(GH + '/repos/' + owner + '/' + repo + '/commits?per_page=10', { headers: ghHeaders(env) });
  if (!r.ok) return { text: 'GitHub HTTP ' + r.status, sources: [] };
  const d = await r.json();
  const lines = d.map(function (c) {
    return '• `' + c.sha.slice(0, 7) + '` — ' + (c.commit.message || '').split('\n')[0] + '  (' + (c.commit.author && c.commit.author.name) + ')';
  });
  return { text: '**Recent commits in `' + owner + '/' + repo + '`:**\n\n' + lines.join('\n'), sources: [] };
}

async function ghPRs(owner, repo, env) {
  const r = await fetch(GH + '/repos/' + owner + '/' + repo + '/pulls?state=open&per_page=10', { headers: ghHeaders(env) });
  if (!r.ok) return { text: 'GitHub HTTP ' + r.status, sources: [] };
  const d = await r.json();
  if (!d.length) return { text: 'No open PRs.', sources: [] };
  const lines = d.map(function (p) { return '• #' + p.number + ' — ' + p.title; });
  return { text: '**Open PRs:**\n\n' + lines.join('\n'), sources: [] };
}

async function ghIssues(owner, repo, env) {
  const r = await fetch(GH + '/repos/' + owner + '/' + repo + '/issues?state=open&per_page=10', { headers: ghHeaders(env) });
  if (!r.ok) return { text: 'GitHub HTTP ' + r.status, sources: [] };
  const d = await r.json();
  if (!d.length) return { text: 'No open issues.', sources: [] };
  const lines = d.map(function (i) { return '• #' + i.number + ' — ' + i.title; });
  return { text: '**Open issues:**\n\n' + lines.join('\n'), sources: [] };
}

async function ghBranches(owner, repo, env) {
  const r = await fetch(GH + '/repos/' + owner + '/' + repo + '/branches?per_page=30', { headers: ghHeaders(env) });
  if (!r.ok) return { text: 'GitHub HTTP ' + r.status, sources: [] };
  const d = await r.json();
  const lines = d.map(function (b) { return '• ' + b.name; });
  return { text: '**Branches:**\n\n' + lines.join('\n'), sources: [] };
}

async function ghListRepos(env) {
  const r = await fetch(GH + '/user/repos?per_page=30&sort=updated', { headers: ghHeaders(env) });
  if (r.status === 401) return { text: 'GITHUB_TOKEN not configured. Add it in Worker Settings → Variables.', sources: [] };
  if (r.status === 403) return { text: 'GITHUB_TOKEN lacks the `repo` scope. Regenerate it with that scope checked.', sources: [] };
  if (!r.ok) return { text: 'GitHub HTTP ' + r.status, sources: [] };
  const d = await r.json();
  const lines = d.map(function (x) { return '• ' + x.full_name + (x.private ? ' (private)' : ''); });
  return { text: '**Your repos:**\n\n' + lines.join('\n'), sources: [] };
}

// ── Write path: create branch + commit + PR (never touches main) ──
async function ghWriteFile(owner, repo, path, content, message, env) {
  // 1. Get default branch
  const repoInfo = await fetch(GH + '/repos/' + owner + '/' + repo, { headers: ghHeaders(env) }).then(function (r) { return r.json(); });
  const base = repoInfo.default_branch || 'main';

  // 2. Get base SHA
  const refInfo = await fetch(GH + '/repos/' + owner + '/' + repo + '/git/refs/heads/' + base, { headers: ghHeaders(env) }).then(function (r) { return r.json(); });
  const baseSha = refInfo.object && refInfo.object.sha;
  if (!baseSha) return { text: 'Could not read base branch SHA for `' + base + '`.', sources: [] };

  // 3. Create new branch
  const newBranch = 'voidai/' + Date.now();
  const mkRes = await fetch(GH + '/repos/' + owner + '/' + repo + '/git/refs', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(env)),
    body: JSON.stringify({ ref: 'refs/heads/' + newBranch, sha: baseSha })
  });
  if (!mkRes.ok) {
    const e = await mkRes.text();
    return { text: 'Branch create failed: HTTP ' + mkRes.status + ' ' + e.slice(0, 200), sources: [] };
  }

  // 4. Check if file exists (to get its blob SHA)
  const existRes = await fetch(GH + '/repos/' + owner + '/' + repo + '/contents' + (path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '') + '?ref=' + newBranch, { headers: ghHeaders(env) });
  let existingSha = null;
  if (existRes.ok) {
    const existData = await existRes.json();
    if (!Array.isArray(existData)) existingSha = existData.sha;
  }

  // 5. Commit
  const putBody = {
    message: message || 'VOIDAI: update ' + path,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: newBranch
  };
  if (existingSha) putBody.sha = existingSha;

  const putRes = await fetch(GH + '/repos/' + owner + '/' + repo + '/contents' + (path ? '/' + path.split('/').map(encodeURIComponent).join('/') : ''), {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(env)),
    body: JSON.stringify(putBody)
  });
  if (!putRes.ok) {
    const e = await putRes.text();
    return { text: 'Commit failed: HTTP ' + putRes.status + ' ' + e.slice(0, 300), sources: [] };
  }

  // 6. Open PR
  const prRes = await fetch(GH + '/repos/' + owner + '/' + repo + '/pulls', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(env)),
    body: JSON.stringify({
      title: message || 'VOIDAI: update ' + path,
      head: newBranch,
      base: base,
      body: 'Automated change by VOIDAI.\n\n**File:** `' + path + '`\n\n' + content.slice(0, 500)
    })
  });
  const prData = await prRes.json();

  if (prData.html_url) {
    return {
      text: '✅ **PR opened:** ' + prData.html_url + '\n\nBranch: `' + newBranch + '`',
      sources: [{ title: 'PR #' + prData.number, url: prData.html_url }]
    };
  }
  return { text: 'PR create failed: HTTP ' + prRes.status + ' ' + JSON.stringify(prData).slice(0, 200), sources: [] };
}

// ── Agent: LLM reads repo, proposes changes ──
async function ghAgent(owner, repo, task, env) {
  const root = await ghReadFile(owner, repo, '', env);
  if (!root || !root.text || root.text.startsWith('GitHub HTTP')) {
    return { text: 'Could not read repo: ' + (root ? root.text : 'unknown'), sources: [] };
  }

  const messages = [
    {
      role: 'system',
      content: 'You are a code agent. Given a repo listing and a task, decide ONE action.\n\n' +
        'Reply in EXACTLY one of these two formats, nothing else:\n\n' +
        'READ <path>\n\n' +
        'or\n\n' +
        'WRITE <path>\n' +
        '---\n' +
        '<file content>\n\n' +
        'Rules:\n' +
        '- To understand existing code, use READ.\n' +
        '- To create or change a file, use WRITE.\n' +
        '- WRITE includes file content after the "---" line.\n' +
        '- One action only. No explanation. No markdown fences.'
    },
    {
      role: 'user',
      content: 'Task: ' + task + '\n\nRepo: ' + owner + '/' + repo + '\n\nRoot listing:\n' + root.text.slice(0, 1500)
    }
  ];

  const result = await callGroq(messages, env);

  let raw = '';
  if (result && result.text) {
    try {
      const parsed = JSON.parse(result.text);
      raw = (parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || '';
    } catch (e) {
      raw = result.text;
    }
  }

  if (!raw || !raw.trim()) {
    return { text: 'Agent got an empty reply. Try `/gh read ' + owner + '/' + repo + ' README.md` directly.', sources: [] };
  }

  raw = raw.replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').trim();

  const lines = raw.split('\n');
  const firstLine = (lines[0] || '').trim();

  const readMatch  = firstLine.match(/^READ\s+(.+)$/i);
  const writeMatch = firstLine.match(/^WRITE\s+(.+)$/i);

  if (readMatch) {
    return await ghReadFile(owner, repo, readMatch[1].trim(), env);
  }

  if (writeMatch) {
    const path = writeMatch[1].trim();
    const sepIndex = raw.indexOf('---');
    if (sepIndex === -1) {
      return { text: 'Agent chose WRITE ' + path + ' but did not include content after "---".', sources: [] };
    }
    const content = raw.slice(sepIndex + 3).replace(/^\s*\n/, '');
    if (!content.trim()) {
      return { text: 'Agent chose WRITE ' + path + ' but content was empty.', sources: [] };
    }
    return await ghWriteFile(owner, repo, path, content, task, env);
  }

  return {
    text: 'Agent reply did not match READ or WRITE format. Raw reply:\n\n' + raw.slice(0, 600) +
          '\n\n---\nUse `/gh read ' + owner + '/' + repo + ' <path>` for a direct read.',
    sources: []
  };
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
    const authed = key === env.VOIDAI;

    // Rate limiting
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const b = rateBuckets.get(ip) || { count: 0, reset: now + RATE_WINDOW };
    if (now > b.reset) { b.count = 0; b.reset = now + RATE_WINDOW; }
    b.count++;
    rateBuckets.set(ip, b);
    if (b.count > RATE_MAX) return json({ error: { message: 'rate limit' } }, 429);

    // GET — health check
    // Unauthenticated: minimal { ok: true } only — no stack fingerprinting
    // Authenticated: full status with mode/feature info
    if (request.method === 'GET') {
      if (!authed) return json({ ok: true });
      return json({
        status: 'ok',
        model: DEFAULT_MODEL,
        provider: 'groq',
        fallback: env.GEMINI_API_KEY ? 'gemini-2.0-flash' : 'none',
        persona: 'phb-human-agent-v2',
        search: !!env.TAVILY_API_KEY,
        modes: ['fast', 'deep', 'research', 'companion', 'ultra', 'coder', 'mini', 'github'],
        version: '2.0.0'
      });
    }

    if (request.method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405);

    // Require auth for POST
    if (!authed) return json({ error: { message: 'unauthorized' } }, 401);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: { message: 'invalid json' } }, 400); }

    // Parse messages — strip any frontend system prompts (Worker is source of truth)
    let messages = Array.isArray(body.messages) ? body.messages : [];
    messages = messages
      .filter(function (m) { return m && m.role !== 'system'; })
      .slice(-MAX_MESSAGES)
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
    const requestedMode = body.mode || null;
    const mode = detectMode(userText, requestedMode);

    // Gather live data context based on intent
    let searchContext = '';
    let contextSources = [];

    if (timeRe.test(userText)) {
      const r = getTime(userText);
      searchContext = r.text;
      contextSources = r.sources;
    } else if (convertRe.test(userText)) {
      const r = convertUnits(userText);
      searchContext = r.text;
      contextSources = r.sources;
    } else if (weatherRe.test(userText)) {
      const r = await getWeather(userText);
      searchContext = r.text;
      contextSources = r.sources;
    } else if (mode === 'research') {
      // Research mode handles its own search
      // Don't pre-fetch here; researchReply will do it
    } else if (factRe.test(userText)) {
      const r = await getWiki(userText);
      searchContext = r.text;
      contextSources = r.sources;
    } else if (liveRe.test(userText)) {
      // Non-research mode but live query — still try Tavily
      if (env.TAVILY_API_KEY) {
        const r = await searchWeb(userText, env);
        searchContext = r.text;
        contextSources = r.sources;
      }
    }

    // Load PHB mind state — hardcoded to jacob until JWT auth is implemented
    // Do NOT trust body.user_id from the client
    const mindState = await loadMindState(env, 'jacob');
    const stateBlock = describeState(mindState);
    const systemPrompt = buildSystemPrompt(searchContext, stateBlock, mode);
    const finalMessages = [{ role: 'system', content: systemPrompt }].concat(messages);
    // ── Total context cap — prevents upstream 413 ──
    const MAX_TOTAL_CHARS = 24000;
    {
      let totalChars = finalMessages.reduce(function (sum, m) {
        return sum + String(m.content || '').length;
      }, 0);
      while (totalChars > MAX_TOTAL_CHARS && finalMessages.length > 2) {
        finalMessages.splice(1, 1);
        totalChars = finalMessages.reduce(function (sum, m) {
          return sum + String(m.content || '').length;
        }, 0);
      }
      if (totalChars > MAX_TOTAL_CHARS) {
        finalMessages[0].content = String(finalMessages[0].content || '').slice(0, MAX_TOTAL_CHARS - 500);
      }
    }

    // Route to the appropriate handler based on mode
    let result;
    let resultSources = contextSources;

    if (mode === 'research') {
      // Pass raw messages + stateBlock; researchReply builds its own system prompt
      result = await researchReply(userText, messages, env, stateBlock);
      // researchReply attaches its own sources
    } else if (mode === 'deep') {
      result = await consensusReply(userText, finalMessages, env);
    } else if (mode === 'companion') {
      // Companion mode: use single model but with PHB-adapted prompt
      result = await callGroq(finalMessages, env);
    } else if (mode === 'ultra') {
      // Ultra — 1M context, frontier reasoning (Nemotron 3 Ultra)
      result = await callOpenRouter(finalMessages, env, 'nvidia/nemotron-3-ultra-550b-a55b:free');
    } else if (mode === 'coder') {
      // Coder — 1M context, agentic coding (Qwen3 Coder 480B)
      result = await callOpenRouter(finalMessages, env, 'cohere/north-mini-code:free');
    } else if (mode === 'mini') {
      // Mini — fast, high-throughput (Nemotron 3.5 Lightning)
      result = await callOpenRouter(finalMessages, env, 'nvidia/nemotron-3.5-lightning:free');
    } else if (mode === 'github') {
  const rest = (userText || '').replace(/^\s*\/gh\s*/i, '').trim();
  const parts = rest.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  const repoSpec = parts[1] || '';
  const rp = repoSpec.split('/');
  const owner = rp[0];
  const repo = rp[1];

  // /gh repos doesn't need owner/repo
  if (cmd === 'repos') {
    const gh = await ghListRepos(env);
    result = { ok: true, status: 200, text: JSON.stringify({
      id: 'gh-' + Date.now(), object: 'chat.completion', model: 'github-api',
      choices: [{ index: 0, message: { role: 'assistant', content: gh.text }, finish_reason: 'stop' }],
      sources: gh.sources || [],
      mode: 'github', model_used: 'github-api'
    })};
  } else if (!owner || !repo) {
    result = { ok: true, status: 200, text: JSON.stringify({
      id: 'gh-help', object: 'chat.completion', model: 'github-api',
      choices: [{ index: 0, message: { role: 'assistant', content:
        '**GitHub commands:**\n\n' +
        '• `/gh read owner/repo path` — read a file\n' +
        '• `/gh list owner/repo [path]` — list a directory\n' +
        '• `/gh search owner/repo query` — search code\n' +
        '• `/gh commits owner/repo` — recent commits\n' +
        '• `/gh prs owner/repo` — open PRs\n' +
        '• `/gh issues owner/repo` — open issues\n' +
        '• `/gh branches owner/repo` — list branches\n' +
        '• `/gh repos` — your repos\n' +
        '• `/gh write owner/repo path -- new content` — open PR with edit\n' +
        '• `/gh agent owner/repo task` — agent reads repo and proposes change'
      }, finish_reason: 'stop' }],
      mode: 'github', model_used: 'github-api'
    })};
  } else {
    const tail = parts.slice(2).join(' ');
    let gh;
    if (cmd === 'read')         gh = await ghReadFile(owner, repo, tail, env);
    else if (cmd === 'list')    gh = await ghReadFile(owner, repo, tail, env);
    else if (cmd === 'search')  gh = await ghSearchCode(owner, repo, tail, env);
    else if (cmd === 'commits') gh = await ghCommits(owner, repo, env);
    else if (cmd === 'prs')     gh = await ghPRs(owner, repo, env);
    else if (cmd === 'issues')  gh = await ghIssues(owner, repo, env);
    else if (cmd === 'branches') gh = await ghBranches(owner, repo, env);
    else if (cmd === 'write') {
      const sp = tail.split(/\s+--\s+/);
      if (sp.length < 2) gh = { text: 'Usage: `/gh write owner/repo path -- new content`', sources: [] };
      else gh = await ghWriteFile(owner, repo, sp[0].trim(), sp[1], 'VOIDAI: update ' + sp[0].trim(), env);
    }
    else if (cmd === 'agent') gh = await ghAgent(owner, repo, tail, env);
    else gh = { text: 'Unknown command. Try `/gh` for help.', sources: [] };

    result = { ok: true, status: 200, text: JSON.stringify({
      id: 'gh-' + Date.now(), object: 'chat.completion', model: 'github-api',
      choices: [{ index: 0, message: { role: 'assistant', content: gh.text }, finish_reason: 'stop' }],
      sources: gh.sources || [],
      mode: 'github', model_used: 'github-api'
    })};
  }
} else {
      // Fast mode
      result = await callGroq(finalMessages, env);
    }

    // Merge sources into response
    if (resultSources.length > 0) {
      result = attachSources(result, resultSources);
    }

    // Update mind state
    try {
      const updated = nudgeAxes(mindState, userText);
      await saveMindState(updated, env, 'jacob');
    } catch (e) {}

    // ── 413 error handling ──
    if (result.status === 413) {
      return json({
        error: { message: 'Request too large. Try a shorter message or start a new conversation.' },
        mode: mode,
        model_used: 'n/a'
      }, 413);
    }
    // Add mode metadata to response
    try {
      const parsed = JSON.parse(result.text);
      parsed.mode = mode;
      parsed.model_used = parsed.model || DEFAULT_MODEL;
      return new Response(JSON.stringify(parsed), {
        status: result.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } catch (e) {
      return new Response(result.text, {
        status: result.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};

