window.VOIDAI_CORTEX = {
  reason(input, state) {
    const weight = window.VOIDAI_SYNAPSE.weight(input, "cortex");
    const route = window.VOIDAI_THALAMUS.route(input);
    const memory = window.VOIDAI_HIPPOCAMPUS.recall(input);
    const emotion = window.VOIDAI_LIMBIC.tone(input);

    const ctx = {
      input,
      weight,
      route,
      memory,
      emotion,
      turns: state.turns
    };

    ctx.mesh = window.VOIDAI_BRAIN_MESH.integrate(ctx);

    let out = window.VOIDAI_LANG.gptStyle(ctx);
    if (window.VOIDAI_CORTEX_HOOK && window.VOIDAI_CORTEX_HOOK.modify) {
      out = window.VOIDAI_CORTEX_HOOK.modify(out, ctx);
    }
    return out;
  }
};
