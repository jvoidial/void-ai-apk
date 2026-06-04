window.VOIDAI_SYNAPSE = {
  weight(a, b) {
    const la = (a || "").length;
    const lb = (b || "").length;
    return ((la + lb) % 17) / 17;
  },
  linkSummary(input) {
    return `synapse:${input.length}`;
  }
};
