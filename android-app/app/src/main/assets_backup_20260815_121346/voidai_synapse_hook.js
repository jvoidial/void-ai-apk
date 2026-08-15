window.VOIDAI_SYNAPSE_HOOK = {
  debug(input) {
    return `synapse-hook:${(input || "").length}`;
  }
};
