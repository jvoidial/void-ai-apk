window.VOIDAI_LANG = {
  gptStyle(ctx) {
    const prefix = `[VOIDAI • ${ctx.mesh}]`;
    const memory = ctx.memory && ctx.memory.length
      ? ` | memory: ${ctx.memory.join(" || ")}`
      : "";
    return `${prefix} ${ctx.input}${memory}`;
  }
};
