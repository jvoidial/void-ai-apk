window.VOIDAI_HIPPOCAMPUS = {
  _store: [],
  recall(input) {
    if (input && input.trim()) this._store.push(input.trim());
    return this._store.slice(-4);
  }
};
