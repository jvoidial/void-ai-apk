window.VOIDAI_BRAIN_MESH = {
  integrate(ctx) {
    const parts = [
      `tone=${ctx.emotion}`,
      `mode=${ctx.route}`,
      `w=${ctx.weight.toFixed(2)}`,
      `turn=${ctx.turns}`
    ];
    return parts.join(" • ");
  }
};
