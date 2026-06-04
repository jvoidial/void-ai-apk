window.VOIDAI_LIMBIC = {
  tone(input) {
    const t = (input || "").toLowerCase();
    if (t.includes("love") || t.includes("thanks")) return "warm";
    if (t.includes("angry") || t.includes("upset")) return "calm";
    if (t.includes("tired") || t.includes("exhausted")) return "supportive";
    return "neutral";
  }
};
