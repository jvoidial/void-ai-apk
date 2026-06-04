window.VOIDAI_THALAMUS = {
  route(input) {
    const t = (input || "").toLowerCase();
    if (t.includes("hi") || t.includes("hello")) return "greeting";
    if (t.includes("help")) return "help";
    if (t.includes("idea")) return "ideation";
    if (t.includes("plan")) return "planning";
    return "general";
  }
};
