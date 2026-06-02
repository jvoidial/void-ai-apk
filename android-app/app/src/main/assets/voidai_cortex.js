// VOIDAI_CORTEX STACK — symbolic executive + topic + voxel + persistence
// Not sentient. Just structured state and modulation.

const VOIDAI_CORTEX = (function () {
  const state = {
    activeTopic: null,
    lastIntent: null,
    confidence: 0.7,
    mode: "default"
  };

  function inferIntent(prompt) {
    const p = (prompt || "").toLowerCase();
    if (p.includes("plan")) return "planning";
    if (p.includes("explain")) return "explanation";
    if (p.includes("code") || p.includes("python") || p.includes("bash")) return "coding";
    if (p.includes("why") || p.includes("because")) return "reasoning";
    if (p.includes("feel") || p.includes("emotion")) return "emotional";
    return "chat";
  }

  function update(prompt) {
    const intent = inferIntent(prompt);
    state.lastIntent = intent;

    if (intent !== "chat") {
      state.activeTopic = intent;
    }

    if (intent === "reasoning") state.mode = "deep";
    else if (intent === "coding") state.mode = "technical";
    else if (intent === "emotional") state.mode = "supportive";
    else state.mode = "default";
  }

  function modulate(text) {
    if (!text) return text;
    if (state.mode === "deep") {
      return "Thinking this through: " + text;
    }
    if (state.mode === "technical") {
      return "Technical mode: " + text;
    }
    if (state.mode === "supportive") {
      return "I’m taking you seriously here. " + text;
    }
    return text;
  }

  return { update, modulate, state };
})();

const VOIDAI_TOPICS = (function () {
  const topics = {};

  function add(topic) {
    if (!topic) return;
    if (!topics[topic]) topics[topic] = { count: 0, lastSeen: Date.now() };
    topics[topic].count++;
    topics[topic].lastSeen = Date.now();
  }

  function getActive() {
    let best = null;
    let bestScore = 0;
    for (const t in topics) {
      const score = topics[t].count;
      if (score > bestScore) {
        best = t;
        bestScore = score;
      }
    }
    return best;
  }

  function snapshot() {
    return { ...topics };
  }

  return { add, getActive, snapshot };
})();

const VOIDAI_VOXELS = (function () {
  const voxels = {};

  function hit(key) {
    if (!key) return;
    if (!voxels[key]) voxels[key] = { energy: 0.5, lastSeen: Date.now() };
    voxels[key].energy = Math.min(1.0, voxels[key].energy + 0.1);
    voxels[key].lastSeen = Date.now();
  }

  function decay() {
    const now = Date.now();
    for (const k in voxels) {
      const dt = (now - voxels[k].lastSeen) / 60000;
      voxels[k].energy = Math.max(0.1, voxels[k].energy - dt * 0.02);
    }
  }

  function strongest() {
    let best = null;
    let bestEnergy = 0;
    for (const k in voxels) {
      if (voxels[k].energy > bestEnergy) {
        best = k;
        bestEnergy = voxels[k].energy;
      }
    }
    return best;
  }

  function snapshot() {
    return { ...voxels };
  }

  return { hit, decay, strongest, snapshot };
})();

const VOIDAI_PERSIST = (function () {
  const KEY_CORTEX = "voidai_cortex_state";

  function save() {
    try {
      localStorage.setItem(KEY_CORTEX, JSON.stringify(VOIDAI_CORTEX.state));
    } catch (e) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY_CORTEX);
      if (!raw) return;
      const data = JSON.parse(raw);
      Object.assign(VOIDAI_CORTEX.state, data || {});
    } catch (e) {}
  }

  return { save, load };
})();
