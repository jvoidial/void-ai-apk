// voidai_hippocampus.js
// Symbolic episodic memory (safe, non-biological)

const VOIDAI_HIPPOCAMPUS = (function () {
  const LIMIT = 64;
  const episodes = [];

  function addEpisode({ user, reply, intent, topic }) {
    episodes.push({
      ts: Date.now(),
      user: user || "",
      reply: reply || "",
      intent: intent || null,
      topic: topic || null
    });
    if (episodes.length > LIMIT) episodes.shift();
  }

  function recent(n) {
    return episodes.slice(-n);
  }

  function snapshot() {
    return episodes.slice();
  }

  return { addEpisode, recent, snapshot };
})();
