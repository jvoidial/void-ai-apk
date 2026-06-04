window.VOIDAI_CORTEX_HOOK = {
  modify(text, ctx) {
    // Simple stylistic tweak: add a soft GPT-like tail
    return text + "  ↳ reasoning: symbolic GPT-style mesh.";
  }
};
