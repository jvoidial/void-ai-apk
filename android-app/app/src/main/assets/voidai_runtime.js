// VOIDAI_RUNTIME — layered brainstem:
// system + conversation + scratchpad + long-term + skills + tools + PHB hook

const VOIDAI_RUNTIME = (function () {
  const memory = {
    system: {
      persona: "VOIDAI — direct, calm, analytical.",
      style: "Short, clear, Copilot-like."
    },
    conversation: [],   // [{role, content, ts}]
    scratchpad: [],     // internal notes
    longTerm: []        // [{type, data, ts}]
  };

  const skills = {};
  const tools = {};

  // --- Memory primitives ---
  function addMessage(role, content) {
    memory.conversation.push({ role, content, ts: Date.now() });
  }

  function addNote(note) {
    memory.scratchpad.push({ note, ts: Date.now() });
  }

  function remember(type, data) {
    memory.longTerm.push({ type, data, ts: Date.now() });
  }

  function recall(filterFn) {
    return memory.longTerm.filter(filterFn || (() => true));
  }

  function getRecent(limit = 16) {
    const h = memory.conversation;
    if (h.length <= limit) return h;
    return h.slice(h.length - limit);
  }

  function summarize(limit = 10) {
    const recent = getRecent(limit);
    if (recent.length === 0) return "";
    return recent
      .map(m => `${m.role === "user" ? "U" : "V"}: ${m.content}`)
      .join(" | ");
  }

  // --- Skills API ---
  function registerSkill(name, fn) {
    skills[name] = fn;
  }

  function listSkills() {
    return Object.keys(skills);
  }

  function runSkill(name, ctx) {
    const skill = skills[name];
    if (!skill) return null;
    return skill(ctx);
  }

  // --- Tools API (placeholder for future IO / OS hooks) ---
  function registerTool(name, fn) {
    tools[name] = fn;
  }

  function runTool(name, args) {
    const tool = tools[name];
    if (!tool) return null;
    return tool(args);
  }

  // --- PHB-API FUSION HOOK ---
  // Drop your PHB/OS logic into this function.
  function phbReason(prompt, mode, contextSummary) {
    // Placeholder: replace with your PHB-API logic.
    // You can import patterns, state machines, etc. conceptually here.
    return {
      hint: "PHB-API hook active (replace this with your own logic).",
      prompt,
      mode,
      contextSummary
    };
  }

  // --- Main reasoning entrypoint ---
  function reason(prompt, mode) {
    const contextSummary = summarize(10);
    const persona = memory.system.persona;
    const style = memory.system.style;

    addNote(`Reasoning on: "${prompt}" in mode ${mode}`);

    const phb = phbReason(prompt, mode, contextSummary);

    return {
      mode,
      prompt,
      contextSummary,
      persona,
      style,
      phb,
      skills: listSkills()
    };
  }

  // --- Built-in skills (starter set) ---
  registerSkill("summarise", ({ contextSummary }) => {
    if (!contextSummary) return "There isn’t much context yet to summarise.";
    return "Quick summary of our recent chat: " + contextSummary;
  });

  registerSkill("reflect", ({ prompt }) => {
    return `You said: "${prompt}". What matters most to you about that?`;
  });

  registerSkill("plan", ({ prompt }) => {
    return [
      `Let’s turn "${prompt}" into a simple plan:`,
      "1) Define the outcome you want.",
      "2) List 2–3 steps you can actually take.",
      "3) Decide when you’ll start.",
      "Tell me your outcome and we’ll fill this in."
    ].join("\n");
  });

  return {
    // memory
    addMessage,
    addNote,
    remember,
    recall,
    getRecent,
    summarize,
    // skills/tools
    registerSkill,
    listSkills,
    runSkill,
    registerTool,
    runTool,
    // reasoning
    reason
  };
})();
