// voidai_brain_mesh.js
// Symbolic integration layer (mesh)

const VOIDAI_BRAIN_MESH = (function () {
  function onUserMessage(text) {
    if (typeof VOIDAI_THALAMUS !== "undefined") {
      VOIDAI_THALAMUS.route(text);
    }
    if (typeof VOIDAI_LIMBIC !== "undefined") {
      VOIDAI_LIMBIC.analyse(text);
    }
  }

  function onReply(userText, replyText) {
    if (typeof VOIDAI_HIPPOCAMPUS !== "undefined") {
      const intent =
        (typeof VOIDAI_CORTEX !== "undefined" && VOIDAI_CORTEX.state.lastIntent) || null;

      const topic =
        (typeof VOIDAI_TOPICS !== "undefined" && VOIDAI_TOPICS.getActive()) ||
        (typeof VOIDAI_CORTEX !== "undefined" && VOIDAI_CORTEX.state.activeTopic) ||
        null;

      VOIDAI_HIPPOCAMPUS.addEpisode({
        user: userText,
        reply: replyText,
        intent,
        topic
      });
    }
  }

  function snapshot() {
    return {
      cortex: typeof VOIDAI_CORTEX !== "undefined" ? { ...VOIDAI_CORTEX.state } : null,
      synapse: typeof VOIDAI_SYNAPSE !== "undefined" && typeof VOIDAI_SYNAPSE.snapshot === "function"
        ? VOIDAI_SYNAPSE.snapshot()
        : null,
      topics: typeof VOIDAI_TOPICS !== "undefined" && typeof VOIDAI_TOPICS.snapshot === "function"
        ? VOIDAI_TOPICS.snapshot()
        : null,
      voxels: typeof VOIDAI_VOXELS !== "undefined" && typeof VOIDAI_VOXELS.snapshot === "function"
        ? VOIDAI_VOXELS.snapshot()
        : null,
      limbic: typeof VOIDAI_LIMBIC !== "undefined" ? VOIDAI_LIMBIC.snapshot() : null,
      thalamus: typeof VOIDAI_THALAMUS !== "undefined" ? VOIDAI_THALAMUS.snapshot() : null,
      hippocampus: typeof VOIDAI_HIPPOCAMPUS !== "undefined" ? VOIDAI_HIPPOCAMPUS.snapshot() : null
    };
  }

  return { onUserMessage, onReply, snapshot };
})();
