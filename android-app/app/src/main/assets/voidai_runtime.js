// VOIDAI_RUNTIME — OS / PHB-API style brain layer
// This is where you plug in your existing logic.

const VOIDAI_RUNTIME = (function () {
  // Simple in-memory state; replace/extend with your PHB-API structures.
  let memory = {
    systemPersona: "You are VOIDAI, a focused, direct, Copilot-style assistant.",
    history: []
  };

  function addMessage(role, content) {
    memory.history.push({ role, content, ts: Date.now() });
  }

  function getContextWindow(limit) {
    const h = memory.history;
    if (h.length <= limit) return h;
    return h.slice(h.length - limit);
  }

  // 🔌 HOOK: plug your PHB-API reasoning here.
  // Given prompt + mode + context, return a "thought" object.
  function reason(prompt, mode) {
    const ctx = getContextWindow(16);

    // Placeholder reasoning — replace with your PHB-API logic.
    const summary = ctx.map(m => `${m.role}: ${m.content}`).join(" | ");

    return {
      mode,
      prompt,
      contextSummary: summary,
      persona: memory.systemPersona
    };
  }

  return {
    addMessage,
    getContextWindow,
    reason
  };
})();
