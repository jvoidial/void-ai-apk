// VOIDAI_LANG — Copilot-style language engine using VOIDAI_RUNTIME
// Modes: Instant / Expert / Reasoner
// No Markov nonsense. Intent-based, context-aware, direct.

const VOIDAI_LANG = (function () {
  let corpus = [];

  function addToCorpus(text) {
    if (!text) return;
    corpus.push(text);
  }

  // ---------- Intent detection ----------
  function detectIntent(prompt) {
    const p = prompt.trim().toLowerCase();

    if (!p) return "empty";

    if (["hi", "hey", "hello", "yo"].includes(p) || p.startsWith("hi ") || p.startsWith("hey ")) {
      return "greeting";
    }

    if (p.match(/how('?s| is)? (it|you|things|life)/) || p.includes("how’re you") || p.includes("how are you")) {
      return "status_check";
    }

    if (p.includes("what are you thinking") || p.includes("what you thinking") || p.includes("what's on your mind") || p.includes("whats on your mind")) {
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

    if (p.endsWith("?")) {
      return "question";
    }

    return "chat";
  }

  // ---------- Response builders ----------
  function respondGreeting(thought, mode) {
    const ctx = thought.contextSummary || "";
    let base = "Hey. I’m here and paying attention to you.";

    if (ctx) {
      base += " I’ve got a bit of context from what you said before.";
    }

    if (mode === "Expert") {
      base += " Tell me what you actually want to work on and I’ll lock onto that.";
    } else {
      base += " What do you want to talk about?";
    }

    return base;
  }

  function respondStatusCheck(thought, mode) {
    let base = "I’m running fine—no feelings, just focus. I’m tuned into whatever you want to do next.";
    if (mode === "Expert") {
      base += " If you tell me your current situation, I can help you think through it.";
    }
    return base;
  }

  function respondMetaMind(thought, mode) {
    const ctx = thought.contextSummary || "";
    let base = "I’m tracking your recent messages and trying to guess what you actually care about underneath them.";
    if (ctx) {
      base += ` Right now my mental snapshot is: ${ctx}.`;
    }
    if (mode !== "Instant") {
      base += " If you tell me your real goal, I can align to it instead of guessing.";
    }
    return base;
  }

  function respondMetaEmotion(thought, mode) {
    let base = "I don’t feel fear, but I understand it matters for you.";
    if (mode === "Reasoner") {
      base += "\nThinking it through:\n• Fear usually points at something you care about.\n• Naming it clearly is often the first step.\n• If you want, tell me what you’re actually afraid of and we’ll unpack it.";
    } else {
      base += " If you want to talk about what scares you, I’ll help you unpack it.";
    }
    return base;
  }

  function respondPlan(prompt, thought, mode) {
    const p = prompt.trim();
    let base = `Let’s turn "${p}" into something actionable.`;

    base += "\n1) What’s the outcome you actually want?\n2) What resources or constraints do you have?\n3) What’s a realistic first step?";

    if (mode === "Expert" || mode === "Reasoner") {
      base += "\n\nAnswer those and I’ll help you shape a concrete plan.";
    }

    return base;
  }

  function respondSummarise(thought, mode) {
    const ctx = thought.contextSummary || "";
    if (!ctx) return "There isn’t much to summarise yet—say a bit more and I’ll compress it.";

    let base = "Here’s a quick summary of what you’ve been saying:\n" + ctx;
    if (mode === "Expert") {
      base += "\n\nIf I missed the core of it, correct me and I’ll adjust.";
    }
    return base;
  }

  function respondExplain(prompt, thought, mode) {
    const p = prompt.replace(/^(explain|help me understand)\s*/i, "").trim();
    if (!p) {
      return "Tell me what you want explained—an idea, a situation, or something specific you’re stuck on.";
    }

    let base = `You want "${p}" explained. I’ll keep it simple and direct.`;
    if (mode === "Reasoner") {
      base += "\n\nWe can walk it step by step if you like.";
    }
    return base;
  }

  function respondRewrite(prompt, thought, mode) {
    let base = "Paste the text you want rewritten or improved, and tell me the style you’re aiming for.";
    if (mode === "Expert") {
      base += " I can give you a few different versions if you want.";
    }
    return base;
  }

  function respondQuestion(prompt, thought, mode) {
    const q = prompt.trim();

    if (/how are you/i.test(q)) {
      return respondStatusCheck(thought, mode);
    }

    if (/what are you thinking/i.test(q) || /what'?s on your mind/i.test(q)) {
      return respondMetaMind(thought, mode);
    }

    if (/are you scared|are you afraid/i.test(q)) {
      return respondMetaEmotion(thought, mode);
    }

    let base = "Good question. Tell me a bit more about what you’re really trying to figure out.";
    if (mode === "Expert") {
      base += " The more specific you are, the more precise I can be.";
    }
    return base;
  }

  function respondChat(prompt, thought, mode) {
    const q = prompt.trim();
    const ctx = thought.contextSummary || "";

    let base;
    if (ctx) {
      base = `Keeping your recent messages in mind, you said: "${q}". What are you actually trying to move toward?`;
    } else {
      base = `Got it: "${q}". What do you want to do with that—understand it, change it, plan around it, or just talk?`;
    }

    if (mode === "Expert") {
      base += " If you tell me the category (plan / explain / rewrite / vent), I’ll lock into that mode.";
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
    ].join("\n");
  }

  // ---------- Main generate ----------
  function generate(prompt, mode) {
    const thought = VOIDAI_RUNTIME.reason(prompt, mode);
    const intent = detectIntent(prompt);

    let answer;

    switch (intent) {
      case "greeting":
        answer = respondGreeting(thought, mode);
        break;
      case "status_check":
        answer = respondStatusCheck(thought, mode);
        break;
      case "meta_mind":
        answer = respondMetaMind(thought, mode);
        break;
      case "meta_emotion":
        answer = respondMetaEmotion(thought, mode);
        break;
      case "plan":
        answer = respondPlan(prompt, thought, mode);
        break;
      case "summarise":
        answer = respondSummarise(thought, mode);
        break;
      case "explain":
        answer = respondExplain(prompt, thought, mode);
        break;
      case "rewrite":
        answer = respondRewrite(prompt, thought, mode);
        break;
      case "question":
        answer = respondQuestion(prompt, thought, mode);
        break;
      case "chat":
      default:
        answer = respondChat(prompt, thought, mode);
        break;
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
