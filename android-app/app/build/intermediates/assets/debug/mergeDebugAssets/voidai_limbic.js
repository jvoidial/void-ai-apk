// voidai_limbic.js
// Symbolic emotional weighting

const VOIDAI_LIMBIC = (function () {
  const state = { valence: 0.0, arousal: 0.5 };

  const NEG = ["stressed", "anxious", "worried", "sad", "tired", "overwhelmed"];
  const POS = ["excited", "happy", "buzzing", "pumped", "grateful", "proud"];

  function analyse(text) {
    const t = (text || "").toLowerCase();
    let score = 0;

    NEG.forEach(w => { if (t.includes(w)) score -= 1; });
    POS.forEach(w => { if (t.includes(w)) score += 1; });

    if (score > 0) state.valence = Math.min(1, state.valence + 0.2);
    else if (score < 0) state.valence = Math.max(-1, state.valence - 0.2);
    else state.valence *= 0.9;

    state.arousal = Math.min(1, Math.max(0, state.arousal + Math.abs(score) * 0.1));

    return { ...state };
  }

  function snapshot() {
    return { ...state };
  }

  return { analyse, snapshot };
})();
