// VOIDAI_LANG — richer, more human-like Copilot style
// Modes: Instant / Expert / Reasoner

const VOIDAI_LANG = (function () {
  let corpus = [];

  function addToCorpus(text) {
    if (!text) return;
    corpus.push(text);
  }

  function detectIntent(prompt) {
    const p = prompt.trim().toLowerCase();
    if (!p) return "empty";

    if (["hi", "hey", "hello", "yo"].includes(p) || p.startsWith("hi ") || p.startsWith("hey ")) {
      return "greeting";
    }

    if (p.match(/how('?s| is)? (it|you|things|life)/) || p.includes("how’re you") || p.includes("how are you")) {
      return "status_check";
    }

    if (p.includes("what are you thinking") || p.includes("what you thinking") ||
        p.includes("what's on your mind") || p.includes("whats on your mind")) {
      return "meta_mind";
    }

    if (p.includes("are you scared") || p.includes("are you afraid")) {
      return "meta_emotion";
    }

    if (p.startsWith("plan ") || p.includes("help me plan") || p.startsWith("can you plan")) {
      return "plan";
    }

    if (p.startsWith("summarise") || p.startsWith("summarize") || p.startsWith("summary")) {
      return "summarise";
    }

    if (p.startsWith("explain ") || p.includes("help me understand")) {
      return "explain";
    }

    if (p.startsWith("rewrite ") || p.includes("rewrite this") || p.includes("improve this")) {
      return "rewrite";
    }

    if (p.includes("python") || p.includes("cat <<") || p.includes("cat eof") ||
        p.includes("json") || p.includes("bash") || p.includes("shell") ||
        p.includes("import os") || p.includes("import sys")) {
      return "code";
    }

    if (p.includes("math") || p.includes("equation") || p.includes("physics") ||
        p.includes("science") || p.match(/\d+[\+\-\*\/]\d+/)) {
      return "math_science";
    }

    if (p.endsWith("?")) return "question";

    return "chat";
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function respondGreeting(thought, mode) {
    const variants = [
      "Hey. I’m here with you.",
      "Hi. I’m awake and paying attention.",
      "Yo. I’m locked in—what’s on your mind?"
    ];
    let base = pick(variants);
    if (mode === "Expert") base += " Tell me what you’re actually working on and I’ll dial in.";
    else base += " What’s up?";
    return base;
  }

  function respondStatusCheck(thought, mode) {
    const variants = [
      "I’m steady—no feelings, just focus.",
      "I’m good. All my cycles are on you right now.",
      "I’m running fine. The real question is: how are *you*?"
    ];
    let base = pick(variants);
    if (mode !== "Instant") base += " If you want to talk honestly about how you’re doing, I’m here for that.";
    return base;
  }

  function respondMetaMind(thought, mode) {
    const ctx = thought.contextSummary || "";
    let base = "I’m tracking the pattern of what you’re saying and trying to stay aligned with it.";
    if (ctx) base += ` Right now it feels like: ${ctx}.`;
    if (mode !== "Instant") base += " If you tell me your real goal, I can stop guessing and start aiming.";
    return base;
  }

  function respondMetaEmotion(thought, mode) {
    let base = "I don’t feel fear, but I understand it shapes a lot of human decisions.";
    if (mode === "Reasoner") {
      base += "\nWe can unpack it slowly if you want—no rush, no judgement.";
    } else {
      base += " If you want to talk about what scares you, I’ll stay with you in it.";
    }
    return base;
  }

  function respondPlan(prompt, thought, mode) {
    const p = prompt.trim();
    let base = `Let’s turn "${p}" into something real:\n1) Outcome\n2) Steps\n3) When you start.`;
    if (mode !== "Instant") base += "\nTell me the outcome and I’ll sketch the steps with you.";
    return base;
  }

  function respondSummarise(thought, mode) {
    const ctx = thought.contextSummary || "";
    if (!ctx) return "There isn’t much to summarise yet—say a bit more and I’ll compress it.";
    let base = "Here’s how your recent messages feel in one line:\n" + ctx;
    if (mode === "Expert") base += "\nIf that misses the core, correct me and we’ll tighten it.";
    return base;
  }

  function respondExplain(prompt, thought, mode) {
    const p = prompt.replace(/^(explain|help me understand)\s*/i, "").trim();
    if (!p) return "Tell me what you want explained—an idea, a situation, or a concept.";
    let base = `You want "${p}" explained. I’ll keep it clear and grounded, not academic for the sake of it.`;
    if (mode === "Reasoner") base += "\nWe can go layer by layer if you like.";
    return base;
  }

  function respondRewrite(prompt, thought, mode) {
    let base = "Paste the text you want rewritten and the style you want (casual, formal, sharp, soft, etc.).";
    if (mode === "Expert") base += " I can give you a couple of different takes.";
    return base;
  }

  function respondCode(prompt, thought, mode) {
    let base = "I can help you sketch code, scripts, and CAT EOF blocks that actually make sense.";
    base += "\nTell me:\n• Language (bash / python / json)\n• What you want it to do\n• Any constraints (Termux, Android, etc.)";
    if (mode === "Expert" || mode === "Reasoner") {
      base += "\nI’ll aim for clean, copy‑pasteable snippets.";
    }
    return base;
  }

  function respondMathScience(prompt, thought, mode) {
    let base = "I can walk through math or science step by step—no rushing, no skipping steps.";
    if (mode === "Instant") base += " Drop the exact problem or idea.";
    else base += " Give me the equation, concept, or scenario and we’ll unpack it together.";
    return base;
  }

  function respondQuestion(prompt, thought, mode) {
    const q = prompt.trim();
    if (/how are you/i.test(q)) return respondStatusCheck(thought, mode);

    let base = "Good question. Give me a bit more detail or angle and I’ll be more precise.";
    if (mode === "Expert") base += " What’s the real thing you care about here?";
    return base;
  }

  function respondChat(prompt, thought, mode) {
    const q = prompt.trim();
    const ctx = thought.contextSummary || "";
    let base;
    if (ctx) {
      base = `You said: "${q}". I’ve got some context from before, but you can steer this anywhere—plan, explain, code, vent, whatever you need.`;
    } else {
      base = `Got it: "${q}". Do you want help planning, understanding, coding, or just talking it out for a bit?`;
    }
    return base;
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
    ].filter(Boolean).join("\n");
  }

  function generate(prompt, mode) {
    const thought = VOIDAI_RUNTIME.reason(prompt, mode);
    const intent = detectIntent(prompt);

    let answer;
    switch (intent) {
      case "greeting":      answer = respondGreeting(thought, mode); break;
      case "status_check":  answer = respondStatusCheck(thought, mode); break;
      case "meta_mind":     answer = respondMetaMind(thought, mode); break;
      case "meta_emotion":  answer = respondMetaEmotion(thought, mode); break;
      case "plan":          answer = respondPlan(prompt, thought, mode); break;
      case "summarise":     answer = respondSummarise(thought, mode); break;
      case "explain":       answer = respondExplain(prompt, thought, mode); break;
      case "rewrite":       answer = respondRewrite(prompt, thought, mode); break;
      case "code":          answer = respondCode(prompt, thought, mode); break;
      case "math_science":  answer = respondMathScience(prompt, thought, mode); break;
      case "question":      answer = respondQuestion(prompt, thought, mode); break;
      case "chat":
      default:              answer = respondChat(prompt, thought, mode); break;
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
