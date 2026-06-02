// VOIDAI_LANG — Hybrid GPT-style generator using VOIDAI_RUNTIME
// Modes: Instant / Expert / Reasoner

const VOIDAI_LANG = (function () {
  let corpus = [];

  function addToCorpus(text) {
    if (!text) return;
    corpus.push(text);
  }

  // --- Markov backbone for continuity ---
  function buildMarkov() {
    const chain = {};
    const all = corpus.join(" ");
    const words = all.split(/\s+/).filter(Boolean);

    for (let i = 0; i < words.length - 1; i++) {
      const w = words[i];
      const next = words[i + 1];
      if (!chain[w]) chain[w] = [];
      chain[w].push(next);
    }

    return { chain, words };
  }

  function generateMarkov(seed, maxLen) {
    const { chain, words } = buildMarkov();
    if (words.length === 0) return "";

    let current =
      seed.split(/\s+/).filter(Boolean).pop() ||
      words[Math.floor(Math.random() * words.length)];

    let out = [current];

    for (let i = 0; i < maxLen; i++) {
      const options = chain[current];
      if (!options || options.length === 0) break;
      current = options[Math.floor(Math.random() * options.length)];
      out.push(current);
    }

    return out.join(" ");
  }

  // --- GPT-style pattern + persona layer ---
  function patternExpand(prompt, thought) {
    const basePersona = thought.persona || "You are VOIDAI.";
    const templates = [
      `${basePersona} You said "${prompt}". I’ll extend that thought in a focused way.`,
      `${basePersona} Building on "${prompt}", I’ll keep the reasoning coherent.`,
      `${basePersona} Following your idea "${prompt}", I’ll continue the line of thought.`,
      `${basePersona} Let’s unpack "${prompt}" and move it forward.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  function reasoningSteps(text, thought) {
    const mode = thought.mode || "Reasoner";
    const ctx = thought.contextSummary || "(minimal context)";
    return [
      `Mode: ${mode}`,
      "Step 1: Interpreting your intent.",
      `Step 2: Reviewing context: ${ctx}`,
      "Step 3: Generating a coherent continuation.",
      "Step 4: Delivering the VOIDAI response.",
      "",
      text
    ].join("\n");
  }

  function generate(prompt, mode) {
    // Ask the runtime (your OS/PHB brain) for a "thought"
    const thought = VOIDAI_RUNTIME.reason(prompt, mode);

    const markov = generateMarkov(prompt, 24);
    const pattern = patternExpand(prompt, thought);

    let base =
      markov.length > 0
        ? `${pattern} ${markov}`
        : `${pattern} VOIDAI is listening and responding.`;

    if (mode === "Expert") {
      base += " I’ll keep this structured and slightly more detailed.";
    }

    if (mode === "Reasoner") {
      base = reasoningSteps(base, thought);
    }

    return "VOIDAI: " + base;
  }

  return {
    addToCorpus,
    generate
  };
})();
