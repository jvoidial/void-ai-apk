// VOIDAI_LANG — Markov-style GPT language module
// Modes: Instant / Expert / Reasoner

const VOIDAI_LANG = (function() {
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
      const next = words[i+1];
      if (!chain[w]) chain[w] = [];
      chain[w].push(next);
    }
    return { chain, words };
  }

  function generateMarkov(seedText, maxLen) {
    const { chain, words } = buildMarkov();
    if (words.length === 0) return "VOIDAI: ...";
    let current = seedText.split(/\s+/).filter(Boolean).pop() || words[Math.floor(Math.random()*words.length)];
    let out = [current];
    for (let i = 0; i < maxLen; i++) {
      const options = chain[current];
      if (!options || options.length === 0) break;
      current = options[Math.floor(Math.random()*options.length)];
      out.push(current);
    }
    return "VOIDAI: " + out.join(" ");
  }

  function generate(prompt, mode) {
    const baseLen =
      mode === "Instant" ? 12 :
      mode === "Expert" ? 32 :
      mode === "Reasoner" ? 48 : 16;

    const raw = generateMarkov(prompt, baseLen);

    if (mode === "Reasoner") {
      return raw + " (thinking in steps…)";
    }
    if (mode === "Expert") {
      return raw + " (more detailed reply)";
    }
    return raw;
  }

  return {
    addToCorpus,
    generate
  };
})();
