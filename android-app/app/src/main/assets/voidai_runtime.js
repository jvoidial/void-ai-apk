window.VOIDAI = {
  energy: 1.0,
  state: { turns: 0 },
  process(input) {
    this.state.turns += 1;
    return window.VOIDAI_CORTEX.reason(input, this.state);
  }
};
