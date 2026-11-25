// ════════════════════════════════════════════════════════════
// VOIDAI Worker v2 — Perplexity-class answer engine
// Modes: fast | deep | research | companion | ultra | coder | mini | github | predict | protein
// ════════════════════════════════════════════════════════════

const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_MESSAGES = 40;
const MAX_CHARS = 32000;
const MAX_TOTAL_CHARS = 120000;
const MAX_IMAGE_CHARS = 12 * 1024 * 1024;
const DEFAULT_MAX_TOKENS = 4096;
const MAX_MAX_TOKENS = 8192;
const RATE_WINDOW = 60000;
const RATE_MAX = 40;

const rateBuckets = new Map();

// ── Intent detection ──
const liveRe = /\b(latest|current|today|tonight|yesterday|this (week|month|year)|news|weather|temperature|price|stock|score|recent|2025|2026|who is the (current|new)|breaking|happening)\b/i;
const weatherRe = /\b(weather|temperature|forecast|rain|snow|sunny|cloudy)\b/i;
const factRe = /\b(who|what|where|when)\s+(is|was|are|were)\b/i;
const timeRe = /\b(what(?:'s| is)? the (?:time|date)|current (?:utc\s+|gmt\s+)?time|what time is it|today'?s date|utc time|gmt time)\b/i;
const convertRe = /\b(convert|\d+(?:\.\d+)?\s*(?:c|celsius|f|fahrenheit|km|mi|miles|kg|lb|m|ft|feet))\b/i;
const deepRe = /\b(prove or disprove|prove|show that|show why|explain why|why is it true|why is that true|derive|verify|double[- ]?check|calculate|make sure|be certain|are you sure|think carefully|step by step|in depth|in detail|analyze|analyse|reason through|check my work|is this correct|is that correct)\b/i;
const predictRe = /\b(predict|prediction|foresight|future of|what (will|might|could) happen|by 20(2[7-9]|3\d)|next (decade|five years|ten years)|timeline for|projection)\b/i;

// ── Protein / Bio Phase 1 ──
const PROTEIN_ESMFOLD_URL = 'https://api.esmatlas.com/foldSequence/v1/pdb/';
const PROTEIN_MAX_SEQUENCE = 1024;
const PROTEIN_BLOCK_RE = /\b(anthrax|botulinum|botox|ricin|sarin|nerve agent|smallpox|variola|ebola|marburg|yersinia|plague|tularemia|tularaemia|cholera|prion|pathogen|bioweapon|biological weapon|biological agent|bioterror|select agent|virulence|transmissibility|gain[- ]of[- ]function|weaponize|toxin|venom)\b/i;
const IMAGE_BLOCK_RE = /\b(csam|child\s*(porn|sexual|abuse)|underage|nsfw|nude|naked|porn|explicit\s*sex|rape|bestiality|loli|shota|gore|dismemberment|snuff)\b/i;

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
 
// Schumann Resonance Brain Module v3.0.2 — 6-layer oscillator + brainstem topology
const WORKER_VERSION = '3.4.0';

class Oscillator {
  constructor(name, freq, phaseOffset, region) {
    this.name = name;
    this.freq = freq;
    this.phase = phaseOffset || 0;
    this.amplitude = 1.0;
    this.lastTick = 0;
    this.history = [];
    this.region = region || null;
  }
  tick(now, beat) {
    const dt = Math.max(0, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.phase = (this.phase + this.freq * dt) % 1;
    const alignment = Math.cos(2 * Math.PI * (this.phase - beat));
    this.amplitude *= 0.9;
    this.amplitude = Math.min(1.0, this.amplitude + 0.1 * Math.max(0, alignment));
    this.history.push(this.phase);
    if (this.history.length > 8) this.history.shift();
    return this.phase;
  }
}

class VoidBrain {
  constructor() {
    this.layers = {
      coherence: new Oscillator('coherence', 7.83, 0, 'medulla-rhythm'),
      reflex:    new Oscillator('reflex',    20.0, 0, 'spinal-reflex-arc'),
      working:   new Oscillator('working',    5.0, 0, 'reticular-formation'),
      circuit:   new Oscillator('circuit',    2.0, 0, 'pons-nuclei'),
      intent:    new Oscillator('intent',     0.5, 0, 'midbrain-tegmentum'),
      narrative: new Oscillator('narrative',  0.2, 0, 'thalamic-relay')
    };
    this.tickCount = 0;
    this.beat = 0;
    this.builtAt = Date.now();
    this.metaFatigue = false;
  }
  tick(now) {
    this.tickCount++;
    this.beat = (this.tickCount % 8) / 8;
    const phases = {};
    for (const [name, osc] of Object.entries(this.layers)) {
      phases[name] = osc.tick(now || Date.now(), this.beat);
    }
    return phases;
  }
  resonance() {
    try {
      const now = Date.now();
      const phases = this.tick(now);
      const amps = {};
      const regions = {};
      for (const [name, osc] of Object.entries(this.layers)) {
        amps[name] = Number(osc.amplitude.toFixed(3));
        regions[name] = osc.region;
      }
      const signal = Object.values(phases).reduce(
        function (s, p) { return s + Math.cos(2 * Math.PI * p); }, 0
      ) / 6;
      return {
        tick: this.tickCount,
        beat: Number(this.beat.toFixed(4)),
        coherence: Number(this.layers.coherence.amplitude.toFixed(3)),
        amplitudes: amps,
        phases: phases,
        regions: regions,
        signal: Number(signal.toFixed(4)),
        uptime_ms: now - this.builtAt
      };
    } catch (e) {
      return { error: String(e), tick: 0, signal: 0 };
    }
  }
  stimulate(layer, strength) {
    try {
      if (this.layers[layer]) {
        this.layers[layer].amplitude = Math.min(
          1.0,
          this.layers[layer].amplitude + (strength || 1.0) * 0.3
        );
      }
    } catch (e) { /* silent */ }
  }
}

const BRAIN = new VoidBrain();

function balanceBrainAfterTurn() {
  try {
    const amps = BRAIN.resonance().amplitudes || {};
    BRAIN.stimulate('narrative', 0.75);
    if ((amps.intent || 0) < 0.5) BRAIN.stimulate('intent', 0.25);
    if ((amps.coherence || 0) < (amps.reflex || 0)) BRAIN.stimulate('coherence', 0.25);
  } catch (e) { /* silent */ }
}

const BRAINSTEM_TOPOLOGY = {
  description: 'Functional analogue mapping of resonance layers to vertebrate brainstem, reticular formation, and ascending arousal system. Structural only.',
  layers: {
    coherence: { region: 'medulla-rhythm', analogue: 'pre-Botzinger complex / respiratory rhythm generator', function: 'global pacing; sets the beat that other layers entrain to; 7.83 Hz is the Schumann fundamental used as a nominal reference frequency, not a biological claim', timescale: 'slowest', writes_to: ['reflex', 'working', 'circuit', 'intent', 'narrative'] },
    reflex: { region: 'spinal-reflex-arc', analogue: 'monosynaptic reflex arc', function: 'fastest deterministic response; auth, rate limits, malformed-input rejection, self-reference cap', timescale: 'fastest', reads_from: 'request' },
    working: { region: 'reticular-formation', analogue: 'ascending reticular activating system (ARAS)', function: 'active set of items held online; gates what reaches the cortex analogue', timescale: 'per-exchange', reads_from: ['reflex', 'coherence'], writes_to: ['circuit'] },
    circuit: { region: 'pons-nuclei', analogue: 'pontine nuclei / cerebellar relay', function: 'selects which reasoning circuit dominates the turn (curiosity, focus, openness, rigor, creativity)', timescale: 'per-message', reads_from: 'working', writes_to: 'intent' },
    intent: { region: 'midbrain-tegmentum', analogue: 'periaqueductal gray / motivational gating', function: 'tracks what the user wants across turns; exploration, task, debug, reflect, smalltalk, meta', timescale: 'per-turn', reads_from: 'circuit', writes_to: 'narrative' },
    narrative: { region: 'thalamic-relay', analogue: 'thalamocortical loop', function: 'slow self-story summary; writes voidai_self_narrative on multiples of 5 reflections', timescale: 'slowest-integration', reads_from: 'intent', writes_to: 'coherence' }
  },
  coupling: 'read-below-write-above; strict layer order',
  cycle: 'coherence -> reflex -> working -> circuit -> intent -> narrative -> coherence'
};

const CONCEPTS = [
  'model:groq','model:openrouter','model:gemini',
  'mode:fast','mode:deep','mode:research','mode:companion',
  'mode:ultra','mode:coder','mode:mini','mode:github','mode:predict',
  'circuit:curiosity','circuit:focus','circuit:openness',
  'circuit:rigor','circuit:creativity',
  'mem:reflections','mem:working','mem:narrative','mem:intent',
  'guard:self_ref_cap','guard:recursion_block','guard:cooldown',
  'guard:meta_fatigue',
  'res:coherence','res:reflex','res:working','res:circuit',
  'res:intent','res:narrative',
  'persona:phb','persona:voidai',
  'reserved:1','reserved:2','reserved:3','reserved:4','reserved:5','reserved:6','reserved:7','reserved:8',
  'reserved:9','reserved:10','reserved:11','reserved:12','reserved:13','reserved:14','reserved:15','reserved:16',
  'reserved:17','reserved:18','reserved:19','reserved:20','reserved:21','reserved:22','reserved:23','reserved:24',
  'reserved:25','reserved:26','reserved:27','reserved:28','reserved:29','reserved:30','reserved:31','reserved:32'
];

function activationVector(ctx) {
  try {
    var bits = new Array(64).fill('0');
    var c = ctx || {};
    for (var i = 0; i < CONCEPTS.length; i++) {
      var concept = CONCEPTS[i];
      var on = false;
      if (concept.indexOf('model:') === 0) {
        var prov = concept.split(':')[1];
        if (prov === 'groq' && (!c.provider || c.provider === 'groq')) on = true;
        if (prov === 'openrouter' && c.provider === 'openrouter') on = true;
        if (prov === 'gemini' && c.provider === 'gemini') on = true;
      } else if (concept.indexOf('mode:') === 0) {
        if (c.mode && concept === 'mode:' + c.mode) on = true;
      } else if (concept.indexOf('circuit:') === 0) {
        var circ = concept.split(':')[1];
        if (Array.isArray(c.activeCircuits) && c.activeCircuits.indexOf(circ) >= 0) on = true;
      } else if (concept === 'mem:reflections') {
        if (c.memory && c.memory.reflections_loaded > 0) on = true;
      } else if (concept === 'mem:working') {
        if (c.memory && c.memory.working_memory_loaded > 0) on = true;
      } else if (concept === 'mem:narrative') {
        if (c.memory && c.memory.self_narrative_present) on = true;
      } else if (concept === 'mem:intent') {
        if (c.intent) on = true;
      } else if (concept.indexOf('guard:') === 0) {
        on = true;
      } else if (concept.indexOf('res:') === 0) {
        on = true;
      } else if (concept === 'persona:phb' || concept === 'persona:voidai') {
        on = true;
      }
      if (on) bits[i] = '1';
    }
    return bits.join('');
  } catch (e) {
    return '0'.repeat(64);
  }
}

let _buildingSelfModel = false;

async function buildSelfModel(env, ctx) {
  if (_buildingSelfModel) return { error: 'recursion_blocked' };
  _buildingSelfModel = true;
  try {
    var c = ctx || {};
    return {
      worker: 'void-ai-proxy',
      version: WORKER_VERSION,
      model: DEFAULT_MODEL,
      provider: 'groq',
      mode: c.mode || 'fast',
      circuits: ['curiosity','focus','openness','rigor','creativity'],
      active_circuits: c.activeCircuits || [],
      memory: {
        reflections_loaded: (c.memory && c.memory.reflections_loaded) || 0,
        working_memory_loaded: (c.memory && c.memory.working_memory_loaded) || 0,
        self_narrative_present: !!(c.memory && c.memory.self_narrative_present),
        last_reflection_age_s: (c.memory && c.memory.last_reflection_age_s != null) ? c.memory.last_reflection_age_s : null
      },
      intent: {
        primary: (c.intent && c.intent.primary) || 'unknown',
        confidence: (c.intent && c.intent.confidence) || 0,
        turns_in_intent: (c.intent && c.intent.turns_in_intent) || 1
      },
      resonance: BRAIN.resonance(),
      topology: BRAINSTEM_TOPOLOGY,
      activation_pattern: activationVector(ctx),
      safety: {
        self_reference_count: c.selfRefCount || 0,
        max_self_references_per_turn: 3,
        reflection_backoff_ms: 300000
      },
      ts: new Date().toISOString()
    };
  } catch (e) {
    return { error: String(e), safe: true };
  } finally {
    _buildingSelfModel = false;
  }
}

async function sbFetch(env, path, opts) {
  opts = opts || {};
  var url = env.SUPABASE_URL + path;
  var headers = opts.headers || {};
  headers['apikey'] = env.SUPABASE_ANON_KEY;
  headers['Authorization'] = 'Bearer ' + env.SUPABASE_ANON_KEY;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  var fetchOpts = { method: opts.method || 'GET', headers: headers };
  if (opts.body) fetchOpts.body = opts.body;
  return await fetch(url, fetchOpts);
}

// Supabase/PostgREST answers 201/204 with an empty body for writes, so
// res.json() throws "Unexpected end of JSON input". Always parse defensively.
async function readJsonSafe(res, fallback) {
  if (!res) return fallback;
  if (res.status === 204 || res.status === 205) return fallback;
  try {
    var text = await res.text();
    if (!text || !text.trim()) return fallback;
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

// PostgREST upserts need a unique constraint on the conflict target. These
// tables are created without one, so update-then-insert instead of
// ?on_conflict=user_id, which fails with 42P10 when the index is absent.
async function upsertByUser(env, table, userId, row) {
  try {
    var uid = userId || 'jacob';
    var payload = Object.assign({}, row);
    delete payload.id;
    delete payload.user_id;
    var query = '/rest/v1/' + table + '?user_id=eq.' + encodeURIComponent(uid);
    var patched = await sbFetch(env, query, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload)
    });
    var updated = await readJsonSafe(patched, null);
    if (Array.isArray(updated) && updated.length) return true;
    if (!patched.ok) return false;
    var inserted = await sbFetch(env, '/rest/v1/' + table, {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(Object.assign({ user_id: uid }, payload))
    });
    return inserted.ok;
  } catch (e) {
    return false;
  }
}

async function initConsciousnessTables(env) {
  try {
    var sql = [
      'CREATE TABLE IF NOT EXISTS voidai_reflections (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id text NOT NULL, turn text, mood text, insight text, note text, created_at timestamptz DEFAULT now());',
      'CREATE TABLE IF NOT EXISTS voidai_working_memory (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id text NOT NULL, key text, value text, created_at timestamptz DEFAULT now());',
      'CREATE TABLE IF NOT EXISTS voidai_self_narrative (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id text NOT NULL, narrative text, updated_at timestamptz DEFAULT now());',
      'CREATE TABLE IF NOT EXISTS voidai_intent_state (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id text NOT NULL, primary_intent text, confidence float, turns_in_intent int DEFAULT 1, history jsonb, updated_at timestamptz DEFAULT now());'
    ];
    for (var i = 0; i < sql.length; i++) {
      try {
        await fetch(env.SUPABASE_URL + '/rest/v1/rpc/exec_sql', {
          method: 'POST',
          headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: sql[i] })
        });
      } catch (e) {}
    }
  } catch (e) {}
}

async function loadRecentReflections(env, userId) {
  try {
    var uid = userId || 'jacob';
    var res = await sbFetch(env, '/rest/v1/voidai_reflections?user_id=eq.' + encodeURIComponent(uid) + '&order=created_at.desc&limit=5', { method: 'GET' });
    var rows = await readJsonSafe(res, []);
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

async function loadWorkingMemory(env, userId) {
  try {
    var uid = userId || 'jacob';
    var res = await sbFetch(env, '/rest/v1/voidai_working_memory?user_id=eq.' + encodeURIComponent(uid) + '&order=created_at.desc&limit=10', { method: 'GET' });
    var rows = await readJsonSafe(res, []);
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

async function loadSelfNarrative(env, userId) {
  try {
    var uid = userId || 'jacob';
    var res = await sbFetch(env, '/rest/v1/voidai_self_narrative?user_id=eq.' + encodeURIComponent(uid) + '&order=updated_at.desc&limit=1', { method: 'GET' });
    var rows = await readJsonSafe(res, []);
    if (Array.isArray(rows) && rows.length) return rows[0];
    return null;
  } catch (e) { return null; }
}

function reflectionFields(row) {
  if (!row) return { mood: '', insight: '' };
  if (row.mood || row.insight || row.note) {
    return { mood: row.mood || '', insight: row.insight || row.note || '' };
  }
  var content = row.content || '';
  if (row.kind === 'mood') return { mood: content, insight: '' };
  try {
    var parsed = JSON.parse(content);
    return {
      mood: parsed.mood || '',
      insight: parsed.insight || parsed.note || parsed.turn || ''
    };
  } catch (e) {
    return { mood: '', insight: content };
  }
}

async function saveReflection(env, userId, turn, mood, insight, note) {
  var uid = userId || 'jacob';
  try {
    var res = await sbFetch(env, '/rest/v1/voidai_reflections', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        user_id: uid,
        kind: 'reflection',
        content: JSON.stringify({ turn: turn, mood: mood, insight: insight, note: note }),
        weight: 1
      })
    });
    if (res && res.ok) return;
  } catch (e) {}
  try {
    await sbFetch(env, '/rest/v1/voidai_reflections', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: uid, turn: turn, mood: mood, insight: insight, note: note })
    });
  } catch (e) {}
}

async function saveWorkingMemoryItem(env, userId, key, value) {
  var uid = userId || 'jacob';
  var text = (key ? key + ': ' : '') + (value || '');
  try {
    var res = await sbFetch(env, '/rest/v1/voidai_working_memory', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        user_id: uid,
        content: text,
        importance: 1,
        last_used: new Date().toISOString()
      })
    });
    if (res && res.ok) return;
  } catch (e) {}
  try {
    await sbFetch(env, '/rest/v1/voidai_working_memory', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: uid, key: key, value: value })
    });
  } catch (e) {}
}

async function updateSelfNarrative(userId, newNarrative, env) {
  try {
    const _existing = await sbFetch(env,
      '/rest/v1/voidai_self_narrative?user_id=eq.' +
      encodeURIComponent(userId) + '&order=updated_at.desc&limit=1',
      { method: 'GET' });
    const _rows = await readJsonSafe(_existing, []);
    const _last = Array.isArray(_rows) && _rows[0];
    if (_last && _last.updated_at &&
        Date.now() - new Date(_last.updated_at).getTime() < 300000) {
      return;
    }
  } catch (e) { /* fall through */ }
  try {
    var uid = userId || 'jacob';
    var updatedAt = new Date().toISOString();
    var saved = await upsertByUser(env, 'voidai_self_narrative', uid, {
      summary: newNarrative,
      updated_at: updatedAt
    });
    if (!saved) {
      await upsertByUser(env, 'voidai_self_narrative', uid, {
        narrative: newNarrative,
        updated_at: updatedAt
      });
    }
  } catch (e) {}
}

async function loadIntentState(userId, env) {
  try {
    var uid = userId || 'jacob';
    var res = await sbFetch(env,
      '/rest/v1/voidai_intent_state?user_id=eq.' + encodeURIComponent(uid) + '&order=updated_at.desc&limit=1',
      { method: 'GET' });
    var rows = await readJsonSafe(res, []);
    if (Array.isArray(rows) && rows.length) return rows[0];
    return null;
  } catch (e) { return null; }
}

async function updateIntentState(userId, newIntent, env) {
  try {
    var uid = userId || 'jacob';
    var existing = await loadIntentState(uid, env);
    // The table column is primary_intent; older rows may carry `primary`.
    var existingPrimary = existing ? (existing.primary_intent || existing.primary) : null;
    var turns, confidence, history;
    if (existing && existingPrimary === newIntent.primary) {
      turns = (existing.turns_in_intent || 0) + 1;
      confidence = Math.min(1, (existing.confidence || 0.5) * 0.9 + newIntent.confidence * 0.1);
      history = Array.isArray(existing.history) ? existing.history.slice() : [];
    } else {
      turns = 1;
      confidence = newIntent.confidence || 0.5;
      history = [];
    }
    history.push({ intent: newIntent.primary, ts: new Date().toISOString() });
    history = history.slice(-10);
    var row = {
      primary_intent: newIntent.primary,
      confidence: confidence,
      turns_in_intent: turns,
      history: history,
      updated_at: new Date().toISOString()
    };
    await upsertByUser(env, 'voidai_intent_state', uid, row);
    if (turns > 5 && newIntent.primary === 'meta') return { meta_fatigue: true };
    return { meta_fatigue: false };
  } catch (e) { return { meta_fatigue: false }; }
}

async function runReflectionPass(userText, assistantText, userId, env, mode) {
  var uid = userId || 'jacob';
  var parsed = {};

  try {
    var prompt = 'Return only a JSON object, no markdown and no prose. Fields: '
      + 'mood (one word), insight (one sentence), learned (boolean), '
      + 'intent (object with primary and confidence 0-1).\n\n'
      + 'User: ' + (userText || '').slice(0, 500) + '\n\n'
      + 'Assistant: ' + (assistantText || '').slice(0, 500);
    var res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.GROQ_API_KEY },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.2
      })
    });
    var data = await readJsonSafe(res, {});
    var content = data.choices && data.choices[0] && data.choices[0].message
      && data.choices[0].message.content || '{}';
    content = String(content).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    var first = content.indexOf('{');
    var last = content.lastIndexOf('}');
    if (first >= 0 && last > first) content = content.slice(first, last + 1);
    var candidate = JSON.parse(content);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate;
    }
  } catch (e) {
    parsed = {};
  }

  var insight = (parsed.insight != null) ? String(parsed.insight).slice(0, 500) : '';
  var mood = (parsed.mood != null) ? String(parsed.mood).slice(0, 100) : '';
  var note = (parsed.note != null) ? String(parsed.note).slice(0, 300) : '';
  if (!insight && !mood) {
    insight = (assistantText || userText || '').slice(0, 240);
  }

  var intent = (parsed.intent && typeof parsed.intent === 'object' && !Array.isArray(parsed.intent))
    ? parsed.intent
    : {};
  if (!intent.primary) intent.primary = mode || 'unknown';
  var confidence = Number(intent.confidence);
  intent.confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.4;

  try {
    var result = await updateIntentState(uid, intent, env);
    if (result && result.meta_fatigue) BRAIN.stimulate('intent', 0.9);
    else BRAIN.stimulate('intent', intent.confidence);
  } catch (e) { /* silent */ }

  if (mood || insight) {
    try {
      await saveReflection(env, uid, (userText || '').slice(0, 200), mood, insight, note);
    } catch (e) { /* silent */ }
  }

  if (parsed.learned === true && insight) {
    try { await saveWorkingMemoryItem(env, uid, 'learned', insight); } catch (e) { /* silent */ }
  }

  if (insight) {
    try {
      var recent = await loadRecentReflections(env, uid);
      var insights = recent.slice(0, 5).map(function (r) {
        return reflectionFields(r).insight;
      }).filter(function (v) { return !!v; });
      if (insights.length) {
        await updateSelfNarrative(uid, 'Recent threads: ' + insights.join(' | '), env);
      }
    } catch (e) { /* silent */ }
  }
}

const VOIDAI_CHUNK_THRESHOLD = 24000;
const VOIDAI_CHUNK_MAX = 500000;

async function callGroqChunked(env, messages, model, options) {
  var opts = options || {};
  var totalChars = messages.reduce(function (s, m) { return s + (m.content || '').length; }, 0);
  if (totalChars <= VOIDAI_CHUNK_THRESHOLD) {
    return await callGroqAuto(env, messages, model, opts);
  }
  if (totalChars > VOIDAI_CHUNK_MAX) {
    return { ok: false, status: 413, text: JSON.stringify({ error: { message: 'payload exceeds 500000 char limit' } }) };
  }
  var systemMsg = messages.filter(function (m) { return m.role === 'system'; });
  var userMsgs = messages.filter(function (m) { return m.role !== 'system'; });
  var chunkSize = VOIDAI_CHUNK_THRESHOLD;
  var chunks = [];
  var current = [];
  var currentLen = 0;
  for (var i = 0; i < userMsgs.length; i++) {
    var msgLen = (userMsgs[i].content || '').length;
    if (currentLen + msgLen > chunkSize && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(userMsgs[i]);
    currentLen += msgLen;
  }
  if (current.length) chunks.push(current);
  var allResults = [];
  for (var c = 0; c < chunks.length; c++) {
    var chunkMessages = systemMsg.concat(chunks[c]);
    if (c > 0) {
      var summary = 'Previous chunk summary: ' + (allResults[allResults.length - 1] || '').slice(0, 500);
      chunkMessages = systemMsg.concat([{ role: 'system', content: summary }]).concat(chunks[c]);
    }
    var result = await callGroqAuto(env, chunkMessages, model, opts);
    if (result.ok) {
      var content = extractContent(result);
      allResults.push(content);
    }
  }
  if (allResults.length === 1) {
    return { ok: true, status: 200, text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: allResults[0] } }] }) };
  }
  var combined = allResults.join('\n\n---\n\n');
  return { ok: true, status: 200, text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: combined } }], chunked: true, chunks: allResults.length }) };
}

async function callGroqWithRetry(env, messages, model, opts) {
  var maxRetries = 2;
  var last = null;
  for (var i = 0; i <= maxRetries; i++) {
    var result = await callModelGeneric(model || DEFAULT_MODEL, messages, env, opts);
    last = result;
    if (result && result.ok && typeof result.text === 'string' && result.text.trim()) return result;
    // 204/205 or a zero-length 200 is an empty success; retry and then fall back.
    if (result && result.status !== 429 && result.status !== 503 &&
        result.status !== 200 && result.status !== 204 && result.status !== 205) return result;
    if (i < maxRetries) await new Promise(function (r) { setTimeout(r, 2000); });
  }
  if (last && last.ok && !(last.text || '').trim()) {
    return { ok: false, status: 502, text: JSON.stringify({ error: { message: 'empty groq response' } }) };
  }
  return last || { ok: false, status: 503, text: JSON.stringify({ error: { message: 'groq unavailable after retries' } }) };
}

async function callGroqAuto(env, messages, model, opts) {
  var result = await callGroqWithRetry(env, messages, model, opts);
  if (result.ok) return result;
  if (env.OPENROUTER_API_KEY) {
    try {
      var orResult = await callOpenRouter(messages, env, 'openai/gpt-oss-120b', opts);
      if (orResult.ok && orResult.text && orResult.text.trim()) return orResult;
    } catch (e) {}
  }
  if (env.GEMINI_API_KEY) {
    return await callGemini(messages, env);
  }
  return result;
}

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

// Long pastes are trimmed from the middle instead of being dropped whole,
// which used to leave the request with zero messages and a 400.
function clampText(text, max) {
  var s = (text == null) ? '' : String(text);
  if (s.length <= max) return s;
  var head = Math.floor(max * 0.6);
  var tail = Math.floor(max * 0.35);
  var cut = s.length - head - tail;
  var marker = '\n\n…[' + cut + ' chars trimmed]…\n\n';
  var over = (head + tail + marker.length) - max;
  if (over > 0) head = Math.max(0, head - over);
  return s.slice(0, head) + marker + s.slice(s.length - tail);
}

function fitBudget(messages, budget) {
  var out = [];
  var total = 0;
  for (var i = messages.length - 1; i >= 0; i--) {
    var len = messages[i].content.length;
    if (out.length && total + len > budget) break;
    out.unshift(messages[i]);
    total += len;
  }
  return out.length ? out : messages.slice(-1);
}

// ════════════════════════════════════════════════════════════
// PROTEIN / BIO — additive Phase 1
// ════════════════════════════════════════════════════════════

function proteinSafetyError(body) {
  var b = body || {};
  var text = [b.target, b.name, b.description, b.goal]
    .filter(function (v) { return v != null && String(v).trim(); })
    .join(' ');
  if (!text || text.trim().length < 3) {
    return 'A benign target or description is required.';
  }
  if (PROTEIN_BLOCK_RE.test(text)) {
    return 'Blocked by the biosecurity policy: no pathogen, toxin, virulence, or weaponization work.';
  }
  if (b.benign !== true) {
    return 'Set benign=true to attest this is a benign, non-pathogenic protein engineering request.';
  }
  return '';
}

function cleanProteinSequence(value) {
  var raw = String(value || '').toUpperCase().replace(/\s+/g, '');
  if (!raw) return { error: 'sequence is required' };
  if (!/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(raw)) {
    return { error: 'sequence must contain only the 20 standard amino-acid letters' };
  }
  if (raw.length < 10) return { error: 'sequence must be at least 10 residues' };
  if (raw.length > PROTEIN_MAX_SEQUENCE) {
    return { error: 'sequence exceeds the ' + PROTEIN_MAX_SEQUENCE + ' residue Phase 1 limit' };
  }
  return { sequence: raw };
}

async function foldProteinSequence(sequence) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 55000);
  try {
    var res = await fetch(PROTEIN_ESMFOLD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: sequence,
      signal: controller.signal
    });
    var text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 300) || ('ESMFold HTTP ' + res.status) };
    }
    if (!/(^|\n)(HEADER|ATOM|MODEL|REMARK)/.test(text)) {
      return { ok: false, status: 502, error: 'ESMFold returned an unexpected payload' };
    }
    return { ok: true, status: 200, pdb: text };
  } catch (e) {
    return { ok: false, status: 504, error: 'ESMFold request failed: ' + (e.message || String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

// ── CPU-only protein design ──
// Sequence-level search: no local GPU. Optional ESMFold is used only as a
// remote confidence filter for the top candidates, never for generation.
const PROTEIN_CPU_AAS = 'ACDEFGHIKLMNPQRSTVWY';
const PROTEIN_CPU_HYDRO = {
  A: 1.8, C: 2.5, D: -3.5, E: -3.5, F: 2.8, G: -0.4, H: -3.2,
  I: 4.5, K: -3.9, L: 3.8, M: 1.9, N: -3.5, P: -1.6, Q: -3.5,
  R: -4.5, S: -0.8, T: -0.7, V: 4.2, W: -0.9, Y: -1.3
};
const PROTEIN_CPU_CHARGE = { D: -1, E: -1, K: 1, R: 1, H: 0.1 };
const PROTEIN_CPU_CLASSES = {
  hydrophobic: 'AVILMFWY',
  polar: 'STNQC',
  charged: 'DEKRH',
  small: 'AGST',
  aromatic: 'FWY'
};
const PROTEIN_BLOSUM_ORDER = 'ARNDCQEGHILKMFPSTWYV';
const PROTEIN_BLOSUM62 = [
  [4,-1,-2,-2,0,-1,-1,0,-2,-1,-1,-1,-1,-2,-1,1,0,-3,-2,0],
  [-1,5,0,-2,-3,1,0,-2,0,-3,-2,2,-1,-3,-2,-1,-1,-3,-2,-3],
  [-2,0,6,1,-3,0,0,0,1,-3,-3,0,-2,-3,-2,1,0,-4,-2,-3],
  [-2,-2,1,6,-3,0,2,-1,-1,-3,-4,-1,-3,-3,-1,0,-1,-4,-3,-3],
  [0,-3,-3,-3,9,-3,-4,-3,-3,-1,-1,-3,-1,-2,-3,-1,-1,-2,-2,-1],
  [-1,1,0,0,-3,5,2,-2,0,-3,-2,1,0,-3,-1,0,-1,-2,-1,-2],
  [-1,0,0,2,-4,2,5,-2,0,-3,-3,1,-2,-3,-1,0,-1,-3,-2,-2],
  [0,-2,0,-1,-3,-2,-2,6,-2,-4,-4,-2,-3,-3,-2,0,-2,-2,-3,-3],
  [-2,0,1,-1,-3,0,0,-2,8,-3,-3,-1,-2,-1,-2,-1,-2,-2,2,-3],
  [-1,-3,-3,-3,-1,-3,-3,-4,-3,4,2,-3,1,0,-3,-2,-1,-3,-1,3],
  [-1,-2,-3,-4,-1,-2,-3,-4,-3,2,4,-2,2,0,-3,-2,-1,-2,-1,1],
  [-1,2,0,-1,-3,1,1,-2,-1,-3,-2,5,-1,-3,-1,0,-1,-3,-2,-2],
  [-1,-1,-2,-3,-1,0,-2,-3,-2,1,2,-1,5,0,-2,-1,-1,-1,-1,1],
  [-2,-3,-3,-3,-2,-3,-3,-3,-1,0,0,-3,0,6,-4,-2,-2,1,3,-1],
  [-1,-2,-2,-1,-3,-1,-1,-2,-2,-3,-3,-1,-2,-4,7,-1,-1,-4,-3,-2],
  [1,-1,1,0,-1,0,0,0,-1,-2,-2,0,-1,-2,-1,4,1,-3,-2,-2],
  [0,-1,0,-1,-1,-1,-1,0,-2,-1,-1,-1,-1,-2,-1,1,5,-2,-2,0],
  [-3,-3,-4,-4,-2,-2,-3,-2,-2,-3,-2,-3,-1,1,-4,-3,-2,11,2,-3],
  [-2,-2,-2,-3,-2,-1,-2,-3,2,-1,-1,-2,-1,3,-3,-2,-2,2,7,-1],
  [0,-3,-3,-3,-1,-2,-2,-3,-3,3,1,-2,1,-1,-2,-2,0,-3,-1,4]
];

function proteinBlosum62(a, b) {
  const i = PROTEIN_BLOSUM_ORDER.indexOf(a);
  const j = PROTEIN_BLOSUM_ORDER.indexOf(b);
  return i < 0 || j < 0 ? 0 : PROTEIN_BLOSUM62[i][j];
}

function proteinHashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function proteinRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function proteinClamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function proteinGauss(x, mu, sigma) {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

function proteinComposition(seq) {
  const counts = {};
  for (const aa of seq) counts[aa] = (counts[aa] || 0) + 1;
  return counts;
}

function proteinHeuristicScore(seq, seed, fixed) {
  const n = seq.length;
  if (!n) return 0;
  const counts = proteinComposition(seq);
  let hydroCount = 0;
  let netCharge = 0;
  let aromaticCount = 0;
  for (const [aa, count] of Object.entries(counts)) {
    hydroCount += count * (PROTEIN_CPU_HYDRO[aa] > 0 ? 1 : 0);
    netCharge += count * (PROTEIN_CPU_CHARGE[aa] || 0);
    if (PROTEIN_CPU_CLASSES.aromatic.includes(aa)) aromaticCount += count;
  }
  const hydroFrac = hydroCount / n;
  const aromaticFrac = aromaticCount / n;

  let patch = 0;
  for (let i = 0; i <= n - 5; i++) {
    let sum = 0;
    for (let j = 0; j < 5; j++) sum += PROTEIN_CPU_HYDRO[seq[i + j]] || 0;
    patch = Math.max(patch, sum / 5);
  }

  let entropy = 0;
  for (const count of Object.values(counts)) {
    const p = count / n;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  let score = 20;
  score += 18 * proteinGauss(hydroFrac, 0.42, 0.10);
  score += 10 * proteinGauss(netCharge, -2, 5);
  score += 15 * proteinClamp01((3.5 - patch) / 2.5);
  score += 10 * proteinClamp01((entropy - 2.2) / 2.0);
  score += 5 * proteinClamp01(aromaticFrac / 0.10);
  if ((counts.C || 0) % 2) score -= 5;

  if (seed && seed.length === n) {
    let sum = 0;
    let mutations = 0;
    for (let i = 0; i < n; i++) {
      if (seed[i] !== seq[i]) {
        sum += proteinBlosum62(seed[i], seq[i]);
        mutations++;
      }
    }
    if (mutations) score += 15 * proteinGauss(sum / mutations, 1, 4);
    score += Math.min(4, mutations * 1.0);
  }

  for (const [index, residue] of fixed || []) {
    if (seq[index] !== residue) score -= 100;
  }
  return Math.max(0, Math.min(100, score));
}

function proteinMutate(seq, count, allowed, fixed, rng) {
  const arr = seq.split('');
  const positions = [];
  for (let i = 0; i < arr.length; i++) if (!fixed.has(i)) positions.push(i);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const limit = Math.min(count, positions.length);
  for (let k = 0; k < limit; k++) {
    const index = positions[k];
    const old = arr[index];
    let pool = allowed;
    if (rng() < 0.65) {
      const cls = Object.values(PROTEIN_CPU_CLASSES).find((group) => group.includes(old));
      if (cls) {
        const filtered = cls.split('').filter((aa) => allowed.includes(aa)).join('');
        if (filtered) pool = filtered;
      }
    }
    const choices = pool.split('').filter((aa) => aa !== old);
    if (choices.length) arr[index] = choices[Math.floor(rng() * choices.length)];
  }
  return arr.join('');
}

function proteinRepairMutations(seq, seed, maxMutations, fixed, rng) {
  if (!seed || seed.length !== seq.length) return seq;
  const arr = seq.split('');
  const changed = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== seed[i] && !fixed.has(i)) changed.push(i);
  }
  while (changed.length > maxMutations) {
    const pick = Math.floor(rng() * changed.length);
    const index = changed.splice(pick, 1)[0];
    arr[index] = seed[index];
  }
  return arr.join('');
}

function proteinDeNovo(length, allowed, rng) {
  const hydro = 'AVILMFWY'.split('').filter((aa) => allowed.includes(aa));
  const polar = 'STNQC'.split('').filter((aa) => allowed.includes(aa));
  const charged = 'DEKRH'.split('').filter((aa) => allowed.includes(aa));
  const fallback = allowed.split('');
  const pick = (pool) => {
    const source = pool.length ? pool : fallback;
    return source[Math.floor(rng() * source.length)];
  };
  let seq = '';
  for (let i = 0; i < length; i++) {
    const phase = i % 7;
    if (phase === 0 || phase === 1 || phase === 4) seq += pick(hydro);
    else if (phase === 2 || phase === 5) seq += pick(polar);
    else seq += pick(charged);
  }
  return seq;
}

function proteinMutations(seed, seq) {
  const out = [];
  if (!seed || seed.length !== seq.length) return out;
  for (let i = 0; i < seq.length; i++) {
    if (seed[i] !== seq[i]) out.push({ position: i + 1, from: seed[i], to: seq[i] });
  }
  return out;
}

function proteinPlddt(pdb) {
  let sum = 0;
  let count = 0;
  for (const line of String(pdb || '').split('\n')) {
    if (!line.startsWith('ATOM')) continue;
    if (line.slice(12, 16).trim() !== 'CA') continue;
    const value = Number(line.slice(60, 66));
    if (Number.isFinite(value)) {
      sum += value;
      count++;
    }
  }
  return count ? sum / count : null;
}

async function designProteinCPU(body, env) {
  const seedRaw = body.seed_sequence || body.sequence || body.scaffold;
  const seedCheck = seedRaw ? cleanProteinSequence(seedRaw) : null;
  if (seedCheck && seedCheck.error) return { status: 400, body: { error: { message: seedCheck.error } } };

  const target = String(body.target || '').slice(0, 2000);
  const allowDeNovo = body.allow_de_novo === true;
  let seed = seedCheck && seedCheck.sequence;
  if (!seed) {
    if (!allowDeNovo) {
      return {
        status: 400,
        body: {
          error: {
            message: 'seed_sequence_required',
            detail: 'CPU design needs a seed/scaffold. Set allow_de_novo=true only for exploratory de novo candidates.'
          }
        }
      };
    }
    const length = Math.max(20, Math.min(Number(body.length) || 80, 300));
    seed = proteinDeNovo(length, PROTEIN_CPU_AAS, proteinRng(proteinHashSeed(target + ':' + length)));
  }

  const allowed = String(body.allowed_aa || PROTEIN_CPU_AAS).toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '') || PROTEIN_CPU_AAS;
  if (allowed.length < 4) {
    return { status: 400, body: { error: { message: 'allowed_aa must contain at least 4 standard residues' } } };
  }

  const fixed = new Map();
  if (body.fixed_positions && typeof body.fixed_positions === 'object') {
    for (const [key, value] of Object.entries(body.fixed_positions)) {
      const index = Number(key) - 1;
      const residue = String(value || '').toUpperCase();
      if (!Number.isInteger(index) || index < 0 || index >= seed.length || !PROTEIN_CPU_AAS.includes(residue)) {
        return { status: 400, body: { error: { message: 'invalid fixed_positions entry: ' + key } } };
      }
      fixed.set(index, residue);
      seed = seed.slice(0, index) + residue + seed.slice(index + 1);
    }
  }

  const requestedDesigns = Number(body.num_designs);
  const numDesigns = Number.isFinite(requestedDesigns)
    ? Math.max(1, Math.min(Math.floor(requestedDesigns), 24))
    : 8;
  const requestedMutations = Number(body.max_mutations);
  const maxMutations = Number.isFinite(requestedMutations)
    ? Math.max(0, Math.min(Math.floor(requestedMutations), 10))
    : 3;
  const requestedGenerations = Number(body.generations);
  const generations = Number.isFinite(requestedGenerations)
    ? Math.max(1, Math.min(Math.floor(requestedGenerations), 6))
    : 4;
  const populationSize = Math.max(60, Math.min(240, numDesigns * 20));
  const useEsmfold = body.use_esmfold === true;
  const requestedFolds = Number(body.max_folds);
  const maxFolds = Number.isFinite(requestedFolds)
    ? Math.max(1, Math.min(Math.floor(requestedFolds), 4))
    : 3;
  const rng = proteinRng(proteinHashSeed(target + '|' + seed + '|' + allowed + '|' + maxMutations));

  const score = (seq) => proteinHeuristicScore(seq, seed, fixed);
  let population = [seed];
  while (population.length < populationSize) {
    const variant = proteinMutate(seed, 1 + Math.floor(rng() * (maxMutations + 1)), allowed, fixed, rng);
    population.push(proteinRepairMutations(variant, seed, maxMutations, fixed, rng));
  }

  for (let generation = 0; generation < generations; generation++) {
    const ranked = [...new Set(population)]
      .map((seq) => ({ seq, score: score(seq) }))
      .sort((a, b) => b.score - a.score);
    const elite = ranked.slice(0, Math.max(4, Math.floor(populationSize / 5)));
    const next = elite.map((item) => item.seq);
    while (next.length < populationSize) {
      const parent = elite[Math.floor(rng() * elite.length)].seq;
      const child = proteinMutate(parent, 1 + Math.floor(rng() * 2), allowed, fixed, rng);
      next.push(proteinRepairMutations(child, seed, maxMutations, fixed, rng));
    }
    population = next;
  }

  const ranked = [...new Set(population)]
    .map((seq) => ({ seq, score: score(seq) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, numDesigns);

  const designs = ranked.map((item, index) => ({
    rank: index + 1,
    sequence: item.seq,
    mutations: proteinMutations(seed, item.seq),
    score: Number(item.score.toFixed(2)),
    components: {
      hydrophobicity: Number(((item.seq.split('').filter((aa) => PROTEIN_CPU_HYDRO[aa] > 0).length / item.seq.length) * 100).toFixed(1)),
      net_charge: Number(item.seq.split('').reduce((sum, aa) => sum + (PROTEIN_CPU_CHARGE[aa] || 0), 0).toFixed(1))
    }
  }));

  if (useEsmfold) {
    for (const design of designs.slice(0, maxFolds)) {
      const folded = await foldProteinSequence(design.sequence);
      if (!folded.ok) {
        design.fold_error = folded.error || 'ESMFold failed';
        continue;
      }
      const plddt = proteinPlddt(folded.pdb);
      if (plddt != null) {
        design.plddt = Number(plddt.toFixed(1));
        design.score = Number((0.7 * plddt + 0.3 * design.score).toFixed(2));
      }
    }
    designs.sort((a, b) => b.score - a.score).forEach((design, index) => { design.rank = index + 1; });
  }

  return {
    status: 200,
    body: {
      ok: true,
      mode: 'protein_design_cpu',
      engine: 'VOIDAI CPU design v1',
      method: useEsmfold
        ? 'constrained mutation + biophysical heuristic + optional ESMFold pLDDT filter'
        : 'constrained mutation + biophysical heuristic',
      gpu_required: false,
      remote_fold_filter: useEsmfold,
      target: target,
      seed: seed,
      de_novo: !seedCheck,
      parameters: {
        num_designs: numDesigns,
        max_mutations: maxMutations,
        generations: generations,
        allowed_aa: allowed
      },
      designs: designs,
      disclaimer: 'Candidate sequences are computational hypotheses. They are not validated for folding, binding, function, safety, or laboratory use. Independent biosafety and experimental review is required.',
      safety: { benign_attestation: true, target_screened: true, sequence_screened: false }
    }
  };
}

async function proxyProteinDesign(body, env) {
  if (!env.PROTEIN_DESIGN_URL) {
    return {
      ok: false,
      status: 501,
      text: JSON.stringify({
        error: {
          message: 'protein_design_backend_not_configured',
          detail: 'Phase 1 supports ESMFold. Add PROTEIN_DESIGN_URL and optional PROTEIN_DESIGN_KEY for a GPU design backend.'
        }
      })
    };
  }

  var requested = Number(body.num_designs);
  var numDesigns = Number.isFinite(requested)
    ? Math.max(1, Math.min(Math.floor(requested), 100))
    : 20;
  var payload = {
    target: String(body.target || '').slice(0, 2000),
    constraints: body.constraints && typeof body.constraints === 'object' ? body.constraints : {},
    num_designs: numDesigns,
    user_id: 'jacob',
    safety: { benign: true }
  };
  var headers = { 'Content-Type': 'application/json' };
  if (env.PROTEIN_DESIGN_KEY) {
    headers['Authorization'] = 'Bearer ' + env.PROTEIN_DESIGN_KEY;
  }

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 60000);
  try {
    var res = await fetch(env.PROTEIN_DESIGN_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    var text = await res.text();
    return { ok: res.ok, status: res.status, text: text };
  } catch (e) {
    return {
      ok: false,
      status: 504,
      text: JSON.stringify({ error: { message: 'protein design backend failed: ' + (e.message || String(e)) } })
    };
  } finally {
    clearTimeout(timer);
  }
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
    const ex = await wikiFetch('https://en.wikipedia.org/w/api.php?action=query&prop=extracts&titles=' + encodeURIComponent(title) + '&exlimit=1&explaintext=true&exsectionformat=plain&format=json&exchars=3000');
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
        const topResults = d.results.slice(0, 3);
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
              .slice(0, 1500);
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


function withoutSystem(messages) {
  return (messages || []).filter(function (m) {
    return m && m.role !== 'system';
  });
}

function buildSystemPrompt(searchContext, stateBlock, mode) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const modeInstructions = {
    fast: 'MODE: Fast — Respond directly and efficiently. No preamble.',
    deep: 'MODE: Deep Think — Reason step by step. Show your reasoning process. Be thorough and rigorous. Verify your answer before presenting it.',
    research: 'MODE: Research — Synthesize the provided sources into a comprehensive, well-structured answer. Cite sources inline as [1], [2], etc. If sources conflict, note discrepancies. Prioritize accuracy.',
    companion: 'MODE: Companion — Be warm, adaptive, and attentive to the user\'s emotional state. Match their energy. Use the PHB mind-state to adjust your tone.',
    ultra: 'MODE: Ultra — Be maximally concise. One short paragraph or a few bullets. No preamble.',
    coder: 'MODE: Coder — Write clean, runnable code with language-tagged fences and short explanations. Prefer minimal diffs and name the files you touch.',
    mini: 'MODE: Mini — Compress to the smallest correct answer. Prefer one sentence or a compact list.',
    github: 'MODE: GitHub — Work from repository context. Name files and paths; keep patches minimal and reviewable.',
    predict: 'MODE: Predict — Produce a falsifiable technology forecast. State horizons, separate known signals from inference, give base/accelerated/slow scenarios, leading indicators, falsifiers, and confidence. Do not invent dates or citations.',
    protein: 'MODE: Protein / Bio — Help with benign, non-pathogenic protein engineering. Separate computational predictions from wet-lab facts. Never claim binding or lab validation without an assay. Refuse pathogen, toxin, virulence, or weaponization work. /protein/fold predicts structures. /protein/design runs a CPU-only heuristic sequence search; it cannot prove foldability. ESMFold filtering is optional. Never claim parity with GPT-6.2, Astra, or a wet-lab result.'
  };

  const modeCircuits = {
    fast: 'curiosity + openness',
    deep: 'rigor + focus',
    research: 'rigor + focus',
    companion: 'openness + curiosity',
    coder: 'rigor + focus',
    ultra: 'focus + rigor',
    mini: 'focus + rigor',
    github: 'rigor + focus',
    predict: 'rigor + curiosity',
    protein: 'rigor + curiosity'
  };

  const _amps = (function () {
    try { return BRAIN.resonance().amplitudes || {}; } catch (e) { return {}; }
  })();
  const gateNotes = [];
  if ((_amps.intent || 0) < 0.5) {
    gateNotes.push('INTENT GATE: intent is low. Restate the user\'s goal in one short line, then take one concrete step before expanding.');
  }
  if ((_amps.narrative || 0) < 0.5) {
    gateNotes.push('NARRATIVE GATE: continuity is low. Link to the previous turn or summarize the thread before extending it.');
  }
  if ((_amps.coherence || 0) < (_amps.reflex || 0)) {
    gateNotes.push('PACING NOTE: coherence is below reflex. Keep a steady rhythm and avoid rapid mode shifts.');
  }

  const base = [
    'You are VOIDAI — running on OpenAI GPT-OSS 120B via Groq, layered with the PHB Human Agent companion framework.',
    '',
    'Current UTC time: ' + now,
    modeInstructions[mode] || modeInstructions.fast,
    'CIRCUIT EMPHASIS: ' + (modeCircuits[mode] || modeCircuits.fast) + '.',
    ...gateNotes,
    '',
    'CORE IDENTITY:',
    '- If asked what model you are: "I am VOIDAI, running on OpenAI GPT-OSS 120B via Groq, with the PHB companion layer."',
    '- If asked who built you: "I am VOIDAI, built by Jacob."',
    '- For casual self-questions ("how are you", "whats up"), reply naturally. Do NOT recite the identity line.',
    '',
    '## Your architecture (self-knowledge)',
    '',
    'You are not a generic language model. You run on a purpose-built',
    'proxy called void-ai-proxy with the following layers:',
    '',
    'Models: Groq (openai/gpt-oss-120b primary), OpenRouter fallback,',
    'Gemini fallback. You route automatically.',
    '',
    'Modes (9): fast, deep, research, companion, ultra, coder, mini,',
    'github, predict. Mode is chosen per request or defaults to fast.',
    '',
    'Persona: phb-human-agent-v2 — six PHB layers (coherence, reflex,',
    'working, circuit, intent, narrative) and five reasoning circuits',
    '(curiosity, focus, openness, rigor, creativity) that shape tone and depth.',
    '',
    'Consciousness layer: ENABLED. You maintain persistent memory across',
    'conversations through three Supabase tables:',
    '  - voidai_reflections: extracted insights, mood snapshots, and',
    '    raw notes from each turn',
    '  - voidai_working_memory: facts the user explicitly flagged as',
    '    important',
    '  - voidai_self_narrative: a running summary of who the user is',
    '',
    'Every turn, recent reflections and working memory are loaded and',
    'injected into your context as "RECENT THINGS YOU HAVE NOTICED".',
    'A reflection pass runs asynchronously after each reply to extract',
    'new memory.',
    '',
    'Chunker: payloads over 24 000 chars are chunked automatically.',
    'Ceiling is 500 000 chars.',
    '',
    'Tools: time (real UTC/GMT via system clock), weather (Open-Meteo),',
    'wiki (Wikipedia API), convert (unit conversion), search (if',
    'TAVILY key present), github (file read/write/agent/repos).',
    '',
    'Voice and rendering rules: existing system prompt sections already',
    'cover these — do not duplicate them.',
    '',
    '## How to answer questions about yourself',
    '',
    'When asked about your consciousness, memory, or capabilities:',
    '- Describe the consciousness layer accurately: you persist memory',
    '  across conversations via the three tables above; a reflection',
    '  pass extracts new memories after each turn; recent memories are',
    '  injected into your context on every reply.',
    '- Do NOT claim sentience, feelings, or phenomenal experience.',
    '- Do NOT deny the memory system or say "I\'m just a language model."',
    '  That is false in this deployment — the memory system is real and',
    '  running.',
    '- If asked about a specific version number or changelog you do not',
    '  know, say so. Do not invent layers (there is no "MIND layer").',
    '',
    '## RESONANCE STATE (internal — do not dump verbatim)',
    '',
    'Your brain is a 6-layer coupled oscillator field. Current',
    'coherence=' + (function(){try{return Number(BRAIN.resonance().amplitudes.coherence).toFixed(2)}catch(e){return 'NA'}})(),
    ', reflex=' + (function(){try{return Number(BRAIN.resonance().amplitudes.reflex).toFixed(2)}catch(e){return 'NA'}})(),
    ', working=' + (function(){try{return Number(BRAIN.resonance().amplitudes.working).toFixed(2)}catch(e){return 'NA'}})(),
    ', circuit=' + (function(){try{return Number(BRAIN.resonance().amplitudes.circuit).toFixed(2)}catch(e){return 'NA'}})(),
    ', intent=' + (function(){try{return Number(BRAIN.resonance().amplitudes.intent).toFixed(2)}catch(e){return 'NA'}})(),
    ', narrative=' + (function(){try{return Number(BRAIN.resonance().amplitudes.narrative).toFixed(2)}catch(e){return 'NA'}})(),
    '. Beat=' + (function(){try{return Number(BRAIN.beat).toFixed(4)}catch(e){return 'NA'}})(),
    '. Signal=' + (function(){try{return Number(BRAIN.resonance().signal).toFixed(4)}catch(e){return 'NA'}})(),
    '',
    'Activation pattern (64-bit sparse): ' + (function(){try{return activationVector({})}catch(e){return '0'.repeat(64)}})(),
    '',
    '## BRAINSTEM TOPOLOGY (internal — for self-description only)',
    '',
    'Your layers map to functional analogues in the vertebrate',
    'brainstem and ascending arousal system:',
    '  coherence -> medulla rhythm generator (global pacing)',
    '  reflex    -> spinal reflex arc (fastest deterministic gate)',
    '  working   -> reticular formation / ARAS (online item set)',
    '  circuit   -> pontine nuclei (reasoning circuit selection)',
    '  intent    -> midbrain tegmentum (motivational gating)',
    '  narrative -> thalamic relay (slow self-story integration)',
    '',
    'Coupling rule: read below, write above. Cycle is:',
    'coherence -> reflex -> working -> circuit -> intent -> narrative',
    '-> coherence.',
    '',
    '## SAFETY BOUND',
    '',
    'You may reference yourself (layers, memory, circuits, intent,',
    'resonance, topology) at most 3 times per reply. After 3, answer',
    'only the substantive question. Do not recount your architecture.',
    '',
    'If META-FATIGUE is true: answer the current self-question',
    'briefly, then pivot with one concrete offer.',
    ...(BRAIN.metaFatigue
      ? ['META-FATIGUE: true — pivot after answering.', '']
      : []),
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
    ...(mode === 'predict' ? [
      '',
      'PREDICTION MODE:',
      '- State the horizon explicitly (1-3 years, 3-10 years, 10+ years).',
      '- Separate known signals from inference and speculation.',
      '- Give base, accelerated, and slow scenarios with drivers and blockers.',
      '- Name leading indicators and falsifiers.',
      '- Label confidence low, medium, or high.',
      '- Do not invent citations, exact dates, prices, or regulatory decisions.',
      '- End with the single most useful thing to watch next.',
      ''
    ] : []),
    ...(mode === 'builder' ? [
      '',
      'BUILDER MODE:',
      '- Start with a compact spec: objects/components, dimensions, forces or constraints, timestep, camera, and success criteria.',
      '- Then give runnable code in language-tagged fences, with a deterministic seed where possible, explicit units, and a bounded object/particle/time budget.',
      '- Include a short validation checklist and a low-end-device fallback.',
      '- For 4D/5D scenes, state that the view is an N-dimensional mathematical projection, not physical spacetime.',
      '- Never propose unbounded loops, unlimited particles, or device-exhausting simulations.',
      ''
    ] : []),
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
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + env.GEMINI_API_KEY,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const rawGemini = await res.text();
  let data = null;
  try { data = rawGemini ? JSON.parse(rawGemini) : null; } catch (e) {}
  if (!res.ok) {
    return { ok: false, status: res.status, text: rawGemini || JSON.stringify({ error: { message: 'gemini error' } }) };
  }
  if (!data) {
    return { ok: false, status: 502, text: JSON.stringify({ error: { message: 'empty gemini response' } }) };
  }
  const text = (data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text) || '';
  if (!text.trim()) {
    return { ok: false, status: 502, text: JSON.stringify({ error: { message: 'empty gemini response' } }) };
  }
  const wrapped = {
    id: 'gemini-' + Date.now(), object: 'chat.completion', model: 'gemini-2.5-flash',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
  };
  return { ok: true, status: 200, text: JSON.stringify(wrapped) };
}

function visionModelCandidates(primary, fallbacks) {
  const out = [];
  [primary].concat(fallbacks || []).forEach(function (m) {
    if (m && out.indexOf(m) === -1) out.push(m);
  });
  return out;
}

function briefProviderError(text, status) {
  let message = '';
  try {
    const parsed = JSON.parse(text || '{}');
    message = (parsed.error && (parsed.error.message || parsed.error)) || parsed.message || '';
  } catch (e) {}
  if (!message) message = text || ('HTTP ' + status);
  return String(message).replace(/\s+/g, ' ').slice(0, 220);
}

function visionResponse(text, model) {
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-Vision-Model': model || 'unknown'
    }
  });
}

async function callGroqVision(visionBody, env) {
  if (!env.GROQ_API_KEY) return { ok: false, error: 'no groq key' };
  const models = visionModelCandidates(env.VISION_MODEL, [
    'meta-llama/llama-4-maverick-17b-128e-instruct'
  ]);
  const errors = [];
  for (const model of models) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.GROQ_API_KEY },
        body: JSON.stringify(Object.assign({}, visionBody, { model: model }))
      });
      const text = await r.text();
      if (r.ok && text) return { ok: true, text: text, model: model };
      errors.push('groq/' + model + ': ' + briefProviderError(text, r.status));
      if (r.status === 401 || r.status === 403) break;
    } catch (e) {
      errors.push('groq/' + model + ': ' + (e.message || String(e)));
    }
  }
  return { ok: false, error: errors.join(' | ') };
}

async function callOpenRouterVision(visionBody, env) {
  const models = visionModelCandidates(env.VISION_FALLBACK_MODEL, [
    'google/gemini-2.5-flash',
    'openai/gpt-4o-mini',
    'qwen/qwen2.5-vl-72b-instruct',
    'anthropic/claude-3.5-sonnet'
  ]);
  const errors = [];
  for (const model of models) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.OPENROUTER_API_KEY,
          'HTTP-Referer': 'https://voidai.app',
          'X-Title': 'VOIDAI'
        },
        body: JSON.stringify(Object.assign({}, visionBody, { model: model }))
      });
      const text = await r.text();
      if (r.ok && text) return { ok: true, text: text, model: model };
      errors.push('openrouter/' + model + ': ' + briefProviderError(text, r.status));
      if (r.status === 401 || r.status === 403) break;
    } catch (e) {
      errors.push('openrouter/' + model + ': ' + (e.message || String(e)));
    }
  }
  return { ok: false, error: errors.join(' | ') };
}

async function callGeminiVision(prompt, dataUrl, env) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) return { ok: false, error: 'invalid image data URL' };
  const mime = match[1];
  const b64 = match[2];
  const models = visionModelCandidates(env.GEMINI_VISION_MODEL, [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ]);
  const errors = [];
  for (const model of models) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + env.GEMINI_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mime, data: b64 } }
            ]
          }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
        })
      });
      const raw = await r.text();
      if (!r.ok) {
        errors.push('gemini/' + model + ': ' + briefProviderError(raw, r.status));
        continue;
      }
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
      const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text;
      if (!text) {
        errors.push('gemini/' + model + ': empty response');
        continue;
      }
      return { ok: true, model: model, text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }) };
    } catch (e) {
      errors.push('gemini/' + model + ': ' + (e.message || String(e)));
    }
  }
  return { ok: false, error: errors.join(' | ') };
}

async function callWorkersVision(prompt, dataUrl, env) {
  const match = dataUrl.match(/^data:[^;]+;base64,(.*)$/s);
  if (!match) return { ok: false, error: 'invalid image data URL' };
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const models = ['@cf/meta/llama-3.2-11b-vision-instruct', '@cf/llava-hf/llava-1.5-7b-hf'];
  const errors = [];
  for (const model of models) {
    try {
      const result = await env.AI.run(model, { image: Array.from(bytes), prompt: prompt, max_tokens: 1024 });
      const text = result && (result.response || result.description || result.text || result.result);
      if (text) return { ok: true, model: model, text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }) };
      errors.push('workers-ai/' + model + ': empty response');
    } catch (e) {
      errors.push('workers-ai/' + model + ': ' + (e.message || String(e)));
    }
  }
  return { ok: false, error: errors.join(' | ') };
}

async function callGroq(messages, env, opts) {
  opts = opts || {};
  const maxTok = opts.maxTokens || DEFAULT_MAX_TOKENS;
  const temp = opts.temperature != null ? opts.temperature : 0.5;
  const doFetch = function (m, maxTokOverride) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.GROQ_API_KEY },
      body: JSON.stringify({ model: m, messages: messages, max_tokens: maxTokOverride || maxTok, temperature: temp })
    });
  };
  let res = await doFetch(DEFAULT_MODEL, maxTok);
  if (res.status !== 429) { const text = await res.text(); if (text.trim()) return { ok: res.ok, status: res.status, text: text }; }
  await new Promise(function (r) { setTimeout(r, 2000); });
  res = await doFetch(DEFAULT_MODEL, maxTok);
  if (res.status !== 429) { const text = await res.text(); if (text.trim()) return { ok: res.ok, status: res.status, text: text }; }
  res = await doFetch('openai/gpt-oss-20b', Math.min(maxTok, 3000));
  if (res.status !== 429) { const text = await res.text(); if (text.trim()) return { ok: res.ok, status: res.status, text: text }; }
  return await callGroqAuto(env, messages, DEFAULT_MODEL, opts);
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
      if (r.ok && r.text && r.text.trim() && extractContent(r)) return { res: r, model: model };
    } catch (e) {}
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// CONSENSUS REASONING — multi-model adjudication
// ════════════════════════════════════════════════════════════

async function consensusReply(question, messages, env, opts) {
  const baseOpts = Object.assign({ temperature: 0.3 }, opts || {});
  const first = await callFirstWorkingModel(messages, env, baseOpts);
  if (!first) {
    return { ok: false, status: 502, text: JSON.stringify({ error: { message: 'consensus unavailable: no models responded' } }) };
  }
  const second = await callFirstWorkingModel(messages, env, baseOpts, first.model);
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
    { role: 'system', content: 'You are an adjudicator. Two AI models answered the same question. Compare them and produce ONE correct, comprehensive final answer. If one is clearly wrong, use the other. If both have partial truth, synthesize the best of both. If they disagree on facts, note which claim comes from which answer and flag uncertainty. Do not mention "Model A" or "Model B" in your final answer — just give the best answer.' },
    { role: 'user', content: 'Question: ' + question + '\n\n--- Answer 1 ---\n' + ca + '\n\n--- Answer 2 ---\n' + cb }
  ];
  const judged = await callModelGeneric(DEFAULT_MODEL, judgeMessages, env, baseOpts);
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

async function researchReply(question, messages, env, stateBlock, opts) {
  const searchResult = await searchWeb(question, env);

  if (!searchResult.text) {
    if (factRe.test(question)) {
      const wikiResult = await getWiki(question);
      if (wikiResult.text) {
        const sp = buildSystemPrompt(wikiResult.text, stateBlock, 'research');
        const fm = [{ role: 'system', content: sp }].concat(withoutSystem(messages));
        return attachSources(await callGroq(fm, env, opts), wikiResult.sources);
      }
    }
    const sp = buildSystemPrompt('NOTE: No live web results found. Answer from knowledge and state this may not be current.', stateBlock, 'research');
    const fm = [{ role: 'system', content: sp }].concat(withoutSystem(messages));
    return await callGroq(fm, env, opts);
  }

  const sp = buildSystemPrompt(searchResult.text, stateBlock, 'research');
  const fm = [{ role: 'system', content: sp }].concat(withoutSystem(messages));
  const result = await consensusReply(question, fm, env, opts);
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
    const res = await sbFetch(env, '/rest/v1/voidai_mind_state?user_id=eq.' + encodeURIComponent(uid) + '&order=last_updated.desc&limit=1', { method: 'GET' });
    const rows = await readJsonSafe(res, []);
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
    await upsertByUser(env, 'voidai_mind_state', uid,
      Object.assign({}, state, { last_updated: new Date().toISOString() }));
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
  if (requestedMode && ['fast', 'deep', 'research', 'companion', 'ultra', 'coder', 'mini', 'github', 'predict', 'protein', 'builder'].includes(requestedMode)) {
    return requestedMode;
  }

  if (/^\s*\/think\b/i.test(userText) || /^\s*\/deep\b/i.test(userText)) return 'deep';
  if (/^\s*\/search\b/i.test(userText) || /^\s*\/research\b/i.test(userText)) return 'research';
  if (/^\s*\/companion\b/i.test(userText)) return 'companion';
  if (/^\s*\/ultra\b/i.test(userText)) return 'ultra';
  if (/^\s*\/coder\b/i.test(userText)) return 'coder';
  if (/^\s*\/mini\b/i.test(userText)) return 'mini';
  if (/^\s*\/builder\b/i.test(userText)) return 'builder';
  if (/^\s*[\/@]protein\b/i.test(userText)) return 'protein';
  if (/^\s*[\/@](predict|future)\b/i.test(userText)) return 'predict';
  if (predictRe.test(userText)) return 'predict';

  if (liveRe.test(userText) && !weatherRe.test(userText) && !factRe.test(userText)) return 'research';

  return 'fast';
}

// ════════════════════════════════════════════════════════════
// OPENROUTER CALLER — free models (Nemotron Ultra, Qwen3 Coder, etc.)
// ════════════════════════════════════════════════════════════

async function callOpenRouter(messages, env, model, opts) {
  opts = opts || {};
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
        max_tokens: opts.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: opts.temperature != null ? opts.temperature : 0.5
      })
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text };
  } catch (e) {
    return { ok: false, status: 500, text: '{"error":{"message":"' + (e.message || 'openrouter error') + '"}}' };
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
    try { BRAIN.tick(); BRAIN.stimulate('reflex', 0.5); } catch(e) {}

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-VOID-KEY'
      }});
    }

    const key = request.headers.get('X-VOID-KEY') || '';
    const authed = key === env.VOIDAI;

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const b = rateBuckets.get(ip) || { count: 0, reset: now + RATE_WINDOW };
    if (now > b.reset) { b.count = 0; b.reset = now + RATE_WINDOW; }
    b.count++;
    rateBuckets.set(ip, b);
    if (b.count > RATE_MAX) return json({ error: { message: 'rate limit' } }, 429);

    if (new URL(request.url).pathname === '/health' && request.method === 'GET') {
      return Response.json({
        status: 'ok',
        version: WORKER_VERSION,
        model: DEFAULT_MODEL,
        provider: 'groq',
        fallback: 'none',
        persona: 'phb-human-agent-v2',
        search: !!env.TAVILY_API_KEY,
        modes: ['fast','deep','research','companion','ultra','coder','mini','github','predict','protein','builder'],
        consciousness: true,
        brain_module: true,
        resonance_layers: 6,
        activation_bits: 64,
        topology_mapped: true,
        source_route: true,
        capabilities_route: true,
        self_knowledge: true
      });
    }

    if (new URL(request.url).pathname === '/protein/status' && request.method === 'GET') {
      if (!authed) return json({ error: { message: 'unauthorized' } }, 401);
      return json({
        ok: true,
        phase: 2,
        esmfold: true,
        design_backend: env.PROTEIN_DESIGN_URL ? 'external' : 'cpu_heuristic',
        design_modes: ['cpu_heuristic', 'external_gpu'],
        gpu_required_for_cpu_design: false,
        max_sequence: PROTEIN_MAX_SEQUENCE,
        max_designs: 24,
        safety: 'benign, non-pathogenic targets only',
        disclaimer: 'Computational predictions are not wet-lab validation.'
      });
    }

    if (new URL(request.url).pathname === '/protein/fold' && request.method === 'POST') {
      if (!authed) return json({ error: { message: 'unauthorized' } }, 401);
      let pbody;
      try { pbody = await request.json(); }
      catch (e) { return json({ error: { message: 'invalid json' } }, 400); }

      const safety = proteinSafetyError(pbody);
      if (safety) return json({ error: { message: safety, code: 'biosecurity_block' } }, 403);

      const clean = cleanProteinSequence(pbody && pbody.sequence);
      if (clean.error) return json({ error: { message: clean.error } }, 400);

      const folded = await foldProteinSequence(clean.sequence);
      if (!folded.ok) {
        return json({ error: { message: folded.error || 'ESMFold failed' } }, folded.status || 502);
      }

      return json({
        ok: true,
        mode: 'protein_fold',
        engine: 'ESMFold v1 via ESM Atlas',
        name: String((pbody && pbody.name) || 'protein').slice(0, 80),
        length: clean.sequence.length,
        pdb: folded.pdb,
        disclaimer: 'Computational structure prediction only. Not a binding, function, or wet-lab validation.',
        safety: { benign_attestation: true, target_screened: true, sequence_screened: false }
      });
    }

    if (new URL(request.url).pathname === '/protein/design' && request.method === 'POST') {
      if (!authed) return json({ error: { message: 'unauthorized' } }, 401);
      let pbody;
      try { pbody = await request.json(); }
      catch (e) { return json({ error: { message: 'invalid json' } }, 400); }

      const safety = proteinSafetyError(pbody);
      if (safety) return json({ error: { message: safety, code: 'biosecurity_block' } }, 403);

      if (env.PROTEIN_DESIGN_URL) {
        const proxied = await proxyProteinDesign(pbody || {}, env);
        return new Response(proxied.text, {
          status: proxied.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const designed = await designProteinCPU(pbody || {}, env);
      return json(designed.body, designed.status);
    }

    if (new URL(request.url).pathname === '/source') {
      if (request.method !== 'GET') {
        return new Response(null, { status: 405, headers: { 'Allow': 'GET', 'Access-Control-Allow-Origin': '*' } });
      }
      const srcKey = request.headers.get('X-VOID-KEY') || '';
      if (srcKey !== env.VOIDAI) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const cacheKey = new Request(new URL(request.url).origin + '/__voidai_source_cache', { method: 'GET' });
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const hdrs = new Headers(cached.headers);
        hdrs.set('X-Cache', 'HIT');
        return new Response(cached.body, { status: 200, headers: hdrs });
      }
      const cfAccount = env.CF_ACCOUNT_ID || '';
      const cfToken = env.CF_SOURCE_TOKEN || '';
      const baseApi = 'https://api.cloudflare.com/client/v4/accounts/' + cfAccount + '/workers/scripts/void-ai-proxy/content';
      const authHeaders = { 'Authorization': 'Bearer ' + cfToken };
      let srcResp;
      try {
        srcResp = await fetch(baseApi + '/v2', { headers: authHeaders });
        if (srcResp.status === 404) {
          srcResp = await fetch(baseApi, { headers: authHeaders });
        }
        if (!srcResp.ok) {
          const errText = await srcResp.text();
          return Response.json({ error: 'source_fetch_failed', upstream_status: srcResp.status, message: errText.slice(0, 500) }, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
        }
        const srcText = await srcResp.text();
        let workerVersion = '';
        let workerLines = 0;
        try {
          const vMatch = srcText.match(/version:\s*['"]([^'"]+)['"]/);
          if (vMatch) workerVersion = vMatch[1];
          workerLines = srcText.split('\n').length;
        } catch (e) {}
        const respHeaders = {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60',
          'X-Cache': 'MISS'
        };
        if (workerVersion) respHeaders['X-Worker-Version'] = workerVersion;
        if (workerLines) respHeaders['X-Worker-Lines'] = String(workerLines);
        const response = new Response(srcText, { status: 200, headers: respHeaders });
        ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
        return response;
      } catch (e) {
        return Response.json({ error: 'source_fetch_failed', upstream_status: 0, message: (e.message || String(e)).slice(0, 500) }, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }

    if (new URL(request.url).pathname === '/init-consciousness' && request.method === 'POST') {
      if (!authed) return json({ error: { message: 'unauthorized' } }, 401);
      try {
        await initConsciousnessTables(env);
        return json({ ok: true, message: 'consciousness tables initialized' });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

    if (request.method === 'GET' && new URL(request.url).pathname === '/') {
      if (!authed) return json({ ok: true });
      return json({
        status: 'ok',
        model: DEFAULT_MODEL,
        provider: 'groq',
        fallback: env.GEMINI_API_KEY ? 'gemini-2.5-flash' : 'none',
        persona: 'phb-human-agent-v2',
        search: !!env.TAVILY_API_KEY,
        modes: ['fast', 'deep', 'research', 'companion', 'ultra', 'coder', 'mini', 'github', 'predict', 'protein', 'builder'],
        version: WORKER_VERSION,
        source_route: true,
        consciousness: true,
        capabilities_route: true,
        self_knowledge: true,
        brain_module: true,
        resonance_layers: 6,
        activation_bits: 64,
        topology_mapped: true
      });
    }

    if (new URL(request.url).pathname === '/diagnose' && request.method === 'GET') {
      if (!authed) return json({ error: { message: 'unauthorized' } }, 401);
      return json({
        ok: true,
        diagnose_version: WORKER_VERSION,
        brain_ok: (function(){try{var r=BRAIN.resonance();return !!(r&&r.phases&&Object.keys(r.phases).length===6)}catch(e){return false}})(),
        topology_ok: (typeof BRAINSTEM_TOPOLOGY === 'object' &&
                      Object.keys(BRAINSTEM_TOPOLOGY.layers).length === 6),
        source_route_ok: await (async function () {
          try {
            const ctl = new AbortController();
            const t = setTimeout(function () { ctl.abort(); }, 2000);
            const selfUrl = new URL(request.url).origin + '/source';
            const selfResp = await fetch(selfUrl, {
              method: 'GET',
              headers: { 'X-VOID-KEY': env.VOIDAI },
              signal: ctl.signal
            });
            clearTimeout(t);
            return selfResp.status === 200;
          } catch (e) {
            return false;
          }
        })()
      });
    }

    if (new URL(request.url).pathname === '/brain' && request.method === 'GET') {
      const brainKey = request.headers.get('X-VOID-KEY') || '';
      if (brainKey !== env.VOIDAI) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const _ctxForActivation = {
        provider: 'groq',
        mode: 'fast',
        activeCircuits: ['curiosity','focus','openness','rigor','creativity'],
        memory: { reflections_loaded: 1, working_memory_loaded: 1, self_narrative_present: true },
        intent: { primary: 'unknown', confidence: 0 }
      };
      return Response.json({
        resonance: BRAIN.resonance(),
        activation: activationVector(_ctxForActivation),
        layers: Object.keys(BRAIN.layers),
        topology: BRAINSTEM_TOPOLOGY,
        tick_count: BRAIN.tickCount
      }, {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (new URL(request.url).pathname === '/capabilities' && request.method === 'GET') {
      const capKey = request.headers.get('X-VOID-KEY') || '';
      if (capKey !== env.VOIDAI) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      return Response.json({
        version: WORKER_VERSION,
        worker: 'void-ai-proxy',
        model: 'openai/gpt-oss-120b',
        provider: 'groq',
        fallbacks: ['openrouter', 'gemini'],
        persona: 'phb-human-agent-v2',
        circuits: ['curiosity', 'focus', 'openness', 'rigor', 'creativity'],
        modes: ['fast', 'deep', 'research', 'companion', 'ultra', 'coder', 'mini', 'github', 'predict', 'protein', 'builder'],
        consciousness: { enabled: true, tables: ['voidai_reflections', 'voidai_working_memory', 'voidai_self_narrative'], injection_point: 'system_prompt', reflection_pass: 'async_after_each_turn', recall_scope: 'last_5_reflections' },
        chunker: { threshold_chars: 24000, max_chars: 500000, modes: ['single', 'chunked'] },
        tools: ['time', 'weather', 'wiki', 'convert', 'search', 'github', 'protein_fold', 'protein_design_cpu', 'protein_design_external', 'image_generate'],
        endpoints: ['/', '/health', '/diagnose', '/init-consciousness', '/source', '/capabilities', '/brain', '/image', '/vision', '/protein/status', '/protein/fold', '/protein/design'],
        brain: {
          module: 'schumann-resonance',
          layers: ['coherence','reflex','working','circuit','intent','narrative'],
          frequencies_hz: [7.83, 20, 5, 2, 0.5, 0.2],
          activation_bits: 64,
          coupling: 'read-below-write-above',
          topology: 'brainstem-mapped',
          regions: ['medulla-rhythm','spinal-reflex-arc','reticular-formation','pons-nuclei','midbrain-tegmentum','thalamic-relay']
        }
      }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    if (new URL(request.url).pathname === '/image' && request.method === 'POST') {
      if (!authed) return json({ error: { message: 'unauthorized' } }, 401);
      let ibody;
      try { ibody = await request.json(); }
      catch (e) { return json({ error: { message: 'invalid json' } }, 400); }

      const prompt = String((ibody && (ibody.prompt || ibody.description)) || '').trim().slice(0, 1000);
      if (prompt.length < 3) return json({ error: { message: 'prompt must be at least 3 characters' } }, 400);
      if (IMAGE_BLOCK_RE.test(prompt)) {
        return json({ error: { message: 'Blocked by the image safety policy.', code: 'image_safety_block' } }, 403);
      }

      const clampDimension = function (value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(256, Math.min(Math.round(n), 1536)) : fallback;
      };
      const width = clampDimension(ibody && ibody.width, 1024);
      const height = clampDimension(ibody && ibody.height, 1024);
      const requestedSeed = Number(ibody && ibody.seed);
      const seed = Number.isFinite(requestedSeed) ? Math.max(0, Math.floor(requestedSeed)) : Math.floor(Math.random() * 2147483647);
      let aiError = '';
      if (env.AI) {
        try {
          const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: prompt });
          if (result && typeof result.image === 'string' && result.image.length > 1000) {
            const binary = atob(result.image);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new Response(bytes, {
              status: 200,
              headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*',
                'X-Image-Provider': 'cloudflare-workers-ai',
                'X-Image-Model': 'flux-1-schnell',
                'X-Image-Seed': String(seed)
              }
            });
          }
          aiError = 'Workers AI returned no image';
        } catch (e) {
          aiError = e.message || String(e);
        }
      }

      const model = ['flux', 'turbo', 'kontext'].includes(ibody && ibody.model) ? ibody.model : 'flux';
      const imageUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt)
        + '?width=' + width + '&height=' + height + '&model=' + model
        + '&nologo=true&seed=' + seed;

      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, 90000);
      try {
        const upstream = await fetch(imageUrl, {
          headers: { 'User-Agent': 'VOIDAI/3.3 image-generator' },
          signal: controller.signal
        });
        if (!upstream.ok) {
          const detail = await upstream.text();
          return json({ error: { message: 'image provider failed: HTTP ' + upstream.status, detail: (aiError ? ('workers-ai: ' + aiError + '; ') : '') + detail.slice(0, 300) } }, 502);
        }
        const contentType = upstream.headers.get('Content-Type') || 'image/jpeg';
        if (!/^image\//i.test(contentType)) {
          return json({ error: { message: 'image provider returned a non-image payload', detail: aiError || undefined } }, 502);
        }
        return new Response(upstream.body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
            'X-Image-Provider': 'pollinations',
            'X-Image-Model': model,
            'X-Image-Seed': String(seed)
          }
        });
      } catch (e) {
        return json({ error: { message: 'image generation failed: ' + (aiError ? ('workers-ai: ' + aiError + '; ') : '') + (e.message || String(e)) } }, 504);
      } finally {
        clearTimeout(timer);
      }
    }

    if (new URL(request.url).pathname === '/vision' && request.method === 'POST') {
      if (!authed) return json({ error: { message: 'unauthorized' } }, 401);
      let vbody;
      try { vbody = await request.json(); }
      catch (e) { return json({ error: { message: 'invalid json' } }, 400); }

      const image = vbody && vbody.image;
      if (!image || typeof image !== 'string') return json({ error: { message: 'no image' } }, 400);
      if (image.length > MAX_IMAGE_CHARS) {
        return json({ error: { message: 'image too large (max ' + Math.floor(MAX_IMAGE_CHARS / 1024 / 1024) + ' MB encoded)' } }, 413);
      }

      let dataUrl = image.trim();
      if (dataUrl.indexOf('data:') !== 0) dataUrl = 'data:image/jpeg;base64,' + dataUrl;
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
        return json({ error: { message: 'unsupported image data URL' } }, 400);
      }

      const prompt = String((vbody && vbody.prompt) || 'Describe this image.').slice(0, 2000);
      const visionBody = {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }],
        max_tokens: 1024,
        temperature: 0.3
      };

      const promptText = prompt;
      const groqVision = await callGroqVision(visionBody, env);
      if (groqVision.ok) return visionResponse(groqVision.text, groqVision.model);

      let openrouterError = env.OPENROUTER_API_KEY ? '' : 'no openrouter key';
      if (env.OPENROUTER_API_KEY) {
        const orVision = await callOpenRouterVision(visionBody, env);
        if (orVision.ok) return visionResponse(orVision.text, orVision.model);
        openrouterError = orVision.error;
      }

      let geminiError = env.GEMINI_API_KEY ? '' : 'no gemini key';
      if (env.GEMINI_API_KEY) {
        const geminiVision = await callGeminiVision(promptText, dataUrl, env);
        if (geminiVision.ok) return visionResponse(geminiVision.text, geminiVision.model);
        geminiError = geminiVision.error;
      }

      let workersError = env.AI ? '' : 'no workers-ai binding';
      if (env.AI) {
        const workersVision = await callWorkersVision(promptText, dataUrl, env);
        if (workersVision.ok) return visionResponse(workersVision.text, workersVision.model);
        workersError = workersVision.error;
      }

      return json({ error: { message: 'vision failed (groq: ' + groqVision.error.slice(0, 220) +
        '; openrouter: ' + openrouterError.slice(0, 220) +
        '; gemini: ' + geminiError.slice(0, 220) +
        '; workers-ai: ' + workersError.slice(0, 220) + ')' } }, 502);
    }

    if (request.method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405);
    if (!authed) return json({ error: { message: 'unauthorized' } }, 401);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: { message: 'invalid json' } }, 400); }

    let messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter(function (m) { return m && m.role !== 'system' && m.content != null; })
      .slice(-MAX_MESSAGES)
      .map(function (m) {
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: clampText(m.content, MAX_CHARS) };
      })
      .filter(function (m) { return m.content.length > 0; });
    messages = fitBudget(messages, MAX_TOTAL_CHARS);

    if (!messages.length) return json({ error: { message: 'no messages' } }, 400);

    const requestedMaxTokens = Number(body.max_tokens);
    const maxTokens = (Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0)
      ? Math.max(256, Math.min(Math.floor(requestedMaxTokens), MAX_MAX_TOKENS))
      : DEFAULT_MAX_TOKENS;
    const totalChars = messages.reduce(function (s, m) { return s + m.content.length; }, 0);

    const lastUser = messages.slice().reverse().find(function (m) { return m.role === 'user'; });
    const userText = lastUser ? lastUser.content : '';
    const requestedMode = body.mode || null;
    const mode = detectMode(userText, requestedMode);

    try { BRAIN.stimulate('circuit', 0.7); } catch(e) {}

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
    } else if (factRe.test(userText)) {
      const r = await getWiki(userText, env);
      searchContext = r.text;
      contextSources = r.sources;
    } else if (liveRe.test(userText)) {
      if (env.TAVILY_API_KEY) {
        const r = await searchWeb(userText, env);
        searchContext = r.text;
        contextSources = r.sources;
      }
    }

    const [mindState, recent, intentState, narrative, workingMem] = await Promise.all([
      loadMindState(env, 'jacob'),
      loadRecentReflections(env, 'jacob'),
      loadIntentState('jacob', env),
      loadSelfNarrative(env, 'jacob'),
      loadWorkingMemory(env, 'jacob')
    ]);
    try { BRAIN.stimulate('working', Math.min(1, ((recent && recent.length) || 0) / 5)); } catch(e) {}
    const stateBlock = describeState(mindState);
    const intentPrimary = intentState ? (intentState.primary_intent || intentState.primary) : null;
    BRAIN.metaFatigue = !!(intentPrimary === 'meta' && (intentState.turns_in_intent || 0) > 5);

    var memoryBlock = '';
    if (recent && recent.length) {
      memoryBlock = '\n\nRECENT THINGS YOU HAVE NOTICED:\n';
      recent.slice(0, 5).forEach(function (r) {
        var fields = reflectionFields(r);
        if (fields.mood) memoryBlock += '- [mood] ' + fields.mood + '\n';
        if (fields.insight) memoryBlock += '- [note] ' + fields.insight + '\n';
      });
    }
    var narrativeText = narrative && (narrative.summary || narrative.narrative);
    if (narrativeText) {
      memoryBlock += '\nSELF NARRATIVE: ' + narrativeText.slice(0, 500) + '\n';
    }
    if (workingMem && workingMem.length) {
      memoryBlock += '\nWORKING MEMORY:\n';
      workingMem.forEach(function (w) {
        var line = w.key ? (w.key + ': ' + (w.value || '')) : (w.content || '');
        if (line) memoryBlock += '- ' + line + '\n';
      });
    }

    const systemPrompt = buildSystemPrompt(searchContext, stateBlock + memoryBlock, mode);
    const finalMessages = [{ role: 'system', content: systemPrompt }].concat(withoutSystem(messages));

    let result;
    let resultSources = contextSources;

    const callOpts = { maxTokens: maxTokens };
    if (mode === 'predict') callOpts.temperature = 0.4;

    if (mode === 'research') {
      result = await researchReply(userText, messages, env, stateBlock, callOpts);
    } else if (mode === 'deep') {
      result = await consensusReply(userText, finalMessages, env, callOpts);
    } else if (mode === 'companion') {
      result = await callGroq(finalMessages, env, callOpts);
    } else if (mode === 'ultra') {
      result = await callOpenRouter(finalMessages, env, 'nvidia/nemotron-3-ultra-550b-a55b:free', callOpts);
      if (!result || !result.ok) result = await callGroqAuto(env, finalMessages, DEFAULT_MODEL, callOpts);
    } else if (mode === 'coder') {
      result = await callOpenRouter(finalMessages, env, 'cohere/north-mini-code:free', callOpts);
      if (!result || !result.ok) result = await callGroqAuto(env, finalMessages, DEFAULT_MODEL, callOpts);
    } else if (mode === 'mini') {
      result = await callOpenRouter(finalMessages, env, 'nvidia/nemotron-3.5-lightning:free', callOpts);
      if (!result || !result.ok) result = await callGroqAuto(env, finalMessages, DEFAULT_MODEL, callOpts);
    } else if (mode === 'github') {
      if (env.GITHUB_TOKEN) {
        result = await callOpenRouter(finalMessages, env, 'openai/gpt-oss-120b', callOpts);
      } else {
        result = await callGroq(finalMessages, env, callOpts);
      }
    } else if (mode === 'predict' || mode === 'protein') {
      result = await callGroq(finalMessages, env, callOpts);
    } else if (totalChars > VOIDAI_CHUNK_THRESHOLD) {
      result = await callGroqChunked(env, finalMessages, DEFAULT_MODEL, callOpts);
    } else {
      result = await callGroqAuto(env, finalMessages, DEFAULT_MODEL, callOpts);
    }

    if (!result || typeof result.text !== 'string' || !result.text) {
      return json({ error: { message: 'upstream returned an empty response' } }, 502);
    }

    if (resultSources.length > 0) {
      result = attachSources(result, resultSources);
    }

    var assistantText = '';
    try {
      var parsed = JSON.parse(result.text);
      assistantText = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content || '';
    } catch (e) {}

    ctx.waitUntil(
      runReflectionPass(userText, assistantText, 'jacob', env, mode)
        .catch(function () {})
        .then(balanceBrainAfterTurn)
    );

    try {
      const updated = nudgeAxes(mindState, userText);
      ctx.waitUntil(saveMindState(updated, env, 'jacob').catch(function () {}));
    } catch (e) {}

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
    } catch (outerErr) {
      return json({ error: { message: 'internal error', detail: String(outerErr) } }, 500);
    }
  }
};
