// VOIDAI_CORTEX_HOOK — connect cortex stack to runtime + language

(function () {
  if (typeof VOIDAI_PERSIST !== "undefined") {
    VOIDAI_PERSIST.load();
  }

  if (typeof VOIDAI_RUNTIME !== "undefined" && typeof VOIDAI_CORTEX !== "undefined") {
    const originalAddMessage = VOIDAI_RUNTIME.addMessage;
    VOIDAI_RUNTIME.addMessage = function (role, content) {
      if (role === "user") {
        VOIDAI_CORTEX.update(content);
        if (typeof VOIDAI_TOPICS !== "undefined") {
          VOIDAI_TOPICS.add(VOIDAI_CORTEX.state.activeTopic);
        }
        if (typeof VOIDAI_VOXELS !== "undefined") {
          VOIDAI_VOXELS.hit(VOIDAI_CORTEX.state.activeTopic);
          VOIDAI_VOXELS.decay();
        }
        if (typeof VOIDAI_PERSIST !== "undefined") {
          VOIDAI_PERSIST.save();
        }
      }
      return originalAddMessage(role, content);
    };
  }

  if (typeof VOIDAI_LANG !== "undefined" && typeof VOIDAI_CORTEX !== "undefined") {
    const originalGenerate = VOIDAI_LANG.generate;
    VOIDAI_LANG.generate = function (prompt, mode) {
      let out = originalGenerate(prompt, mode);
      const prefix = "VOIDAI: ";
      if (out.startsWith(prefix)) {
        const body = out.slice(prefix.length);
        const mod = VOIDAI_CORTEX.modulate(body);
        return prefix + mod;
      }
      return VOIDAI_CORTEX.modulate(out);
    };
  }
})();
