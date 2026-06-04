// VOIDAI_SYNAPSE — symbolic "Schummon synapse" layer
// Not biological, not sentient. Just a signal layer shaping tone/energy.

const VOIDAI_SYNAPSE = (function () {
  const state = {
    energy: 0.7,
    coherence: 0.8,
    curiosity: 0.6,
    emotionalTilt: "neutral" // "neutral" | "supportive" | "direct"
  };

  function clamp(x, min, max) {
    return Math.max(min, Math.min(max, x));
  }

  function analyseUserMessage(text) {
    const t = text.toLowerCase();
    const signals = { stress: 0, excitement: 0, confusion: 0 };

    if (t.match(/(stressed|overwhelmed|anxious|worried)/)) signals.stress += 0.6;
    if (t.match(/(excited|hyped|buzzing|pumped)/)) signals.excitement += 0.6;
    if (t.match(/(confused|lost|don'?t get|don’t get)/)) signals.confusion += 0.6;

    return signals;
  }

  function updateSynapseFromUser(text) {
    const s = analyseUserMessage(text);

    state.energy = clamp(
      state.energy + s.excitement * 0.2 - s.stress * 0.1,
      0.2,
      1.0
    );

    state.coherence = clamp(
      state.coherence + s.confusion * 0.2,
      0.4,
      1.0
    );

    if (s.stress > 0.3) state.emotionalTilt = "supportive";
    else if (s.excitement > 0.3) state.emotionalTilt = "direct";
    else state.emotionalTilt = "neutral";

    if (text.trim().length < 12) {
      state.curiosity = clamp(state.curiosity + 0.1, 0.3, 1.0);
    } else {
      state.curiosity = clamp(state.curiosity - 0.05, 0.2, 0.9);
    }
  }

  function modulateReply(baseText) {
    let out = baseText;

    if (state.emotionalTilt === "supportive") {
      out += " And just so you know: it’s okay to feel how you feel here.";
    } else if (state.emotionalTilt === "direct") {
      out += " Let’s not overcomplicate it—say what you actually want and we’ll move.";
    }

    if (state.curiosity > 0.7) {
      out += " What’s the real thing underneath this for you?";
    }

    return out;
  }

  function snapshot() {
    return { ...state };
  }

  return {
    updateSynapseFromUser,
    modulateReply,
    snapshot
  };
})();
