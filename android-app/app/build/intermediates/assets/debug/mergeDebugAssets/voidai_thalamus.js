// voidai_thalamus.js
// Symbolic routing + gating

const VOIDAI_THALAMUS = (function () {
  const gates = {
    cortex: 1.0,
    synapse: 1.0,
    limbic: 1.0,
    hippocampus: 1.0
  };

  function route(prompt) {
    const p = (prompt || "").toLowerCase();

    gates.limbic = p.match(/feel|emotion|stress|anxious|happy|sad/) ? 1.0 : 0.6;
    gates.cortex = 1.0;
    gates.synapse = 1.0;
    gates.hippocampus = 1.0;

    return { ...gates };
  }

  function snapshot() {
    return { ...gates };
  }

  return { route, snapshot };
})();
