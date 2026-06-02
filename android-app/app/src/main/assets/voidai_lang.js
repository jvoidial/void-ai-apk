// VOIDAI_LANG — Copilot-style language engine using VOIDAI_RUNTIME
// Modes: Instant / Expert / Reasoner
// Uses skills when intent matches, otherwise general reply.

const VOIDAI_LANG = (function () {
  let corpus = [];

  function addToCorpus(text) {
    if (!text) return;
    corpus.push(text);
  }

  // Light Markov texture
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

    const out = [current];

    for (let i = 0; i < maxLen; i++) {
      const options = chain[current];
      if (!options || options.length === 0) break;
      current = options[Math.floor(Math.random() * options.length)];
      out.push(current);
    }

    return out.join(" ");
  }

  // --- Intent + skill routing ---
  function detectSkill(prompt) {
    const p = prompt.toLowerCase();

    if (p.startsWith("summarise") || p.startsWith("summarize")) return "summarise";
    if (p.startsWith("summary")) return "summarise";

    if (p.startsWith("reflect") || p.includes("think about this")) return "reflect";

    if (p.startsWith("plan") || p.includes("help me plan")) return "plan";

    return null;
  }

  function isQuestion(text) {
    return /[?？]$/.test(text.trim());
  }

  function baseAnswer(prompt, thought, mode) {
    const q = prompt.trim();
    const ctx = thought.contextSummary || "";

    if (isQuestion(q)) {
      if (/how are you/i.test(q)) {
        return "I’m good — focused and ready. What’s next for you?";
      }
      if (/what are you thinking/i.test(q)) {
        return "Mostly about your last few messages and what you might be aiming for.";
      }
      if (/are you scared/i.test(q)) {
        return "No — just logic and text. But we can talk about fear if you want.";
      }
      if (/what'?s on your mind/i.test(q)) {
        return "You, this chat, and your next move.";
      }
      return "Good question. What are you really trying to figure out underneath that?";
    }

    if (ctx) {
      return `Keeping your recent messages in mind: "${q}". What direction do you want to push this in?`;
    }

    return `Got it: "${q}". Tell me what you want to do with that.`;
  }

  function reasoningWrap(text, thought) {
    const ctx = thought.contextSummary || "(light context)";
    const phbHint = thought.phb && thought.phb.hint ? thought.phb.hint : "";
    return [
      "Thinking it through:",
      `• Context: ${ctx}`,
      phbHint ? `• PHB layer: ${phbHint}` : "",
      "• Focus: what you said and what you might need next.",
      "",
      text
    ].join("\n");
  }

  function generate(prompt, mode) {
    const thought = VOIDAI_RUNTIME.reason(prompt, mode);

    // 1) Try skill routing
    const skillName = detectSkill(prompt);
    if (skillName) {
      const skillResult = VOIDAI_RUNTIME.runSkill(skillName, {
        prompt,
        contextSummary: thought.contextSummary,
        mode
      });
      if (skillResult) {
        let out = skillResult;
        if (mode === "Expert") {
          out += "\n\nIf you want, we can go deeper on any part of this.";
        }
        if (mode === "Reasoner") {
          out = reasoningWrap(out, thought);
        }
        return "VOIDAI: " + out;
      }
    }

    // 2) General Copilot-style answer
    let answer = baseAnswer(prompt, thought, mode);

    const markovTail = generateMarkov(prompt, 10);
    if (markovTail) answer += " " + markovTail;

    if (mode === "Expert") {
      answer += " If you want, I can break this into clearer steps or options.";
    }

    if (mode === "Reasoner") {
      answer = reasoningWrap(answer, thought);
    }

    return "VOIDAI: " + answer;
  }

  return {
    addToCorpus,
    generate
  };
})();
