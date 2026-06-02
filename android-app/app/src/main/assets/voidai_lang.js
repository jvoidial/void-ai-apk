// VOIDAI GPT — Hybrid Markov + Pattern Language Engine
// Modes: Instant / Expert / Reasoner
// Identity: VOIDAI

const VOIDAI_LANG = (function () {
  let corpus = [];

  function addToCorpus(text) {
    if (!text) return;
    corpus.push(text);
  }

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

  function patternExpand(prompt) {
    const templates = [
      `You said "${prompt}". I’m extending that thought.`,
      `Building on "${prompt}", here’s a continuation.`,
      `Following your idea "${prompt}", I’ll keep the flow going.`,
      `Let’s expand on "${prompt}" with a bit more structure.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  function reasoningSteps(text) {
    return [
      "Step 1: Interpreting your intent.",
      "Step 2: Mapping it to patterns I’ve seen.",
      "Step 3: Generating a coherent continuation.",
      "Step 4: Delivering the VOIDAI response.",
      "",
      text,
    ].join("\n");
  }

  function generate(prompt, mode) {
    const markov = generateMarkov(prompt, 24);
    const pattern = patternExpand(prompt);

    let base =
      markov.length > 0
        ? `${pattern} ${markov}`
        : `${pattern} VOIDAI is listening.`;

    if (mode === "Expert") {
      base += " I’ll make this a bit more structured.";
    }

    if (mode === "Reasoner") {
      base = reasoningSteps(base);
    }

    return "VOIDAI: " + base;
  }

  return {
    addToCorpus,
    generate,
  };
})();
