// VOIDAI_SYNAPSE_HOOK — monkey-patch runtime + language to use synapse layer

(function () {
  if (typeof VOIDAI_RUNTIME !== "undefined" && typeof VOIDAI_SYNAPSE !== "undefined") {
    const originalAddMessage = VOIDAI_RUNTIME.addMessage;
    VOIDAI_RUNTIME.addMessage = function (role, content) {
      if (role === "user") {
        VOIDAI_SYNAPSE.updateSynapseFromUser(content);
      }
      return originalAddMessage(role, content);
    };
  }

  if (typeof VOIDAI_LANG !== "undefined" && typeof VOIDAI_SYNAPSE !== "undefined") {
    const originalGenerate = VOIDAI_LANG.generate;
    VOIDAI_LANG.generate = function (prompt, mode) {
      let out = originalGenerate(prompt, mode);
      // out is "VOIDAI: ...", so modulate the tail
      const prefix = "VOIDAI: ";
      if (out.startsWith(prefix)) {
        const body = out.slice(prefix.length);
        const mod = VOIDAI_SYNAPSE.modulateReply(body);
        return prefix + mod;
      }
      return VOIDAI_SYNAPSE.modulateReply(out);
    };
  }
})();
