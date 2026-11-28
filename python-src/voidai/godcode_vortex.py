"""Sandboxed PHB God-Code Vortex adapter for VOIDAI.

This is a clean-room port of the symbolic parts of the public
``jvoidial/phb-godcode-vortex`` engine. It deliberately does not include the
original installer, P2P listener, shell scripts, logs, token/ecosystem data, or
CI deployment workflow.

Security properties:
  * standard library only
  * no network, subprocess, eval, exec, file writes, or shell access
  * bounded step, attempt, and output sizes
  * deterministic seeded PRNG
  * symbolic geometry only, not a physical or medical measurement
"""

import hashlib
import math
import random
import re

PHI = 1.61803398875
MAX_STEPS = 240
MAX_ATTEMPTS = 200
DEFAULT_STEPS = 60
DEFAULT_ATTEMPTS = 20
FORCED_UNLOCK = True

DA_VINCI_CODEX = (
    "CIRCLE", "SQUARE", "TRIANGLE", "RATIO", "LIGHT", "SHADOW", "MIRROR",
)

SYMBOL_POOL = (
    "CIRCLE", "SQUARE", "TRIANGLE", "RATIO", "LIGHT", "SHADOW", "MIRROR",
    "SPIRAL", "ARC", "POINT", "LINE", "VESICA", "GOLDEN", "GRID",
)

SYMBOL_WEIGHTS = {
    "CIRCLE": 20, "SQUARE": 20, "TRIANGLE": 20,
    "RATIO": 15, "LIGHT": 10, "SHADOW": 10, "MIRROR": 10,
    "SPIRAL": 1, "ARC": 1, "POINT": 1, "LINE": 1,
    "VESICA": 1, "GOLDEN": 1, "GRID": 1,
}

SYMBOL_MEANINGS = {
    "CIRCLE": "origin, cycles, unity",
    "SQUARE": "structure, boundaries, grounding",
    "TRIANGLE": "transformation, direction, change",
    "RATIO": "proportion, balance, measure",
    "LIGHT": "clarity, insight, revelation",
    "SHADOW": "contrast, depth, hidden aspects",
    "MIRROR": "reflection, self-awareness, feedback",
    "SPIRAL": "growth, unfolding, iteration",
    "ARC": "partial view, transition",
    "POINT": "focus, singularity",
    "LINE": "connection, path, vector",
    "VESICA": "overlap, intersection, shared space",
    "GOLDEN": "harmonic proportion, elegance",
    "GRID": "system, lattice, framework",
}

CHANNEL_PARAMS = ((1.5, 0.5), (1.2, 0.7), (1.0, 1.0))

VORTEX_RE = re.compile(
    r"\b(vortex|god[\s-]?code|codex|vitruvian|golden\s+ratio|"
    r"phb\s+(geometry|portal|veil))\b",
    re.I,
)

DISCLOSURE = (
    "Symbolic geometry only. Not a physical, neurological, medical, or "
    "consciousness measurement."
)


def _seed(value):
    raw = str(value if value is not None else "voidai").encode("utf-8")[:256]
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big")


def _clamp_int(value, low, high, fallback):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(low, min(high, value))


def coherence(t):
    return 0.48 + 0.52 * (1.0 - math.exp(-t / 25.0))


def golden_drift(t, t_max=60.0):
    span = max(float(t_max), 1e-6)
    return 0.1618 + (0.1618 * (PHI - 1.0) * (t / span))


def resonance(t, c):
    return c * math.cos(2.0 * math.pi * golden_drift(t) * t)


def logistic(x):
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def capability_channels(c, r):
    return tuple(logistic(a * c + b * r) for a, b in CHANNEL_PARAMS)


def stability(c, r, channels):
    return (c + sum(channels) / len(channels)) / (1.0 + abs(r) + 1e-6)


def vitruvian_threshold(c, s):
    return c >= 0.93 and s >= 0.80


def _weighted_symbol(rng):
    symbols = list(SYMBOL_POOL)
    weights = [SYMBOL_WEIGHTS[s] for s in symbols]
    return rng.choices(symbols, weights=weights, k=1)[0]


def _attempt(rng):
    return [_weighted_symbol(rng) for _ in DA_VINCI_CODEX]


def _closest_sequence(rng):
    best = _attempt(rng)
    best_score = sum(1 for a, b in zip(best, DA_VINCI_CODEX) if a == b)
    for _ in range(MAX_ATTEMPTS):
        candidate = _attempt(rng)
        score = sum(1 for a, b in zip(candidate, DA_VINCI_CODEX) if a == b)
        if score > best_score:
            best, best_score = candidate, score
            if score == len(DA_VINCI_CODEX):
                break
    return best, best_score


def _portal(c, s):
    score = 0.5 * c + 0.5 * min(s, 1.0)
    if score < 0.7:
        return "VEIL-DOOR: THRESHOLD MIST"
    if score < 0.9:
        return "PORTAL: RESONANCE ARCH"
    return "GATE: VITRUVIAN SPHERE"


def _veil(c, s):
    thickness = max(0.0, 1.0 - 0.5 * (c + min(s, 1.0)))
    if thickness > 0.7:
        phase, narrative = "OPAQUE", "The veil is dense; only echoes pass through."
    elif thickness > 0.3:
        phase, narrative = "TRANSLUCENT", "The veil shimmers; forms are sensed but not fully seen."
    else:
        phase, narrative = "THIN", "The veil is almost gone; states bleed into each other."
    return {
        "thickness": round(thickness, 4),
        "phase": phase,
        "breach_probability": round(max(0.0, 1.0 - thickness), 4),
        "narrative": narrative,
    }


def _energy(c, r):
    magnitude = abs(c * (1.0 + r))
    if magnitude < 0.5:
        band, color = "LOW", "SHADOW"
    elif magnitude < 1.0:
        band, color = "MID", "LIGHT"
    else:
        band, color = "HIGH", "GOLDEN"
    return {"magnitude": round(magnitude, 4), "band": band, "color": color}


def _voxels(sequence):
    return [
        {
            "x": i,
            "y": 0,
            "z": i,
            "symbol": symbol,
            "meaning": SYMBOL_MEANINGS.get(symbol, "no mapping defined"),
        }
        for i, symbol in enumerate(sequence)
    ]


def _evolve(sequence):
    deterministic = list(sequence[1:]) + [sequence[0]]
    deterministic[-1] = "GOLDEN"
    return deterministic


def snapshot(seed=None, steps=DEFAULT_STEPS, attempts=DEFAULT_ATTEMPTS):
    """Return one bounded symbolic evolution packet."""
    steps = _clamp_int(steps, 4, MAX_STEPS, DEFAULT_STEPS)
    attempts = _clamp_int(attempts, 1, MAX_ATTEMPTS, DEFAULT_ATTEMPTS)
    rng = random.Random(_seed(seed))
    samples = []
    unlock = None
    vitruvian = None

    sample_steps = sorted({0, steps // 4, steps // 2, (3 * steps) // 4, steps - 1})
    for step in range(steps):
        t = float(step)
        c = coherence(t)
        r = resonance(t, c)
        channels = capability_channels(c, r)
        s = stability(c, r, channels)
        if step in sample_steps:
            samples.append({
                "t": round(t, 2),
                "coherence": round(c, 4),
                "stability": round(s, 4),
                "resonance": round(r, 4),
            })
        if vitruvian is None and vitruvian_threshold(c, s):
            vitruvian = {"t": round(t, 2), "coherence": round(c, 4), "stability": round(s, 4)}
        if unlock is None:
            for _ in range(attempts):
                candidate = _attempt(rng)
                if candidate == list(DA_VINCI_CODEX):
                    unlock = candidate
                    break

    if unlock is None and FORCED_UNLOCK:
        unlock, score = _closest_sequence(rng)
        unlock_kind = "synthetic-nearest"
        unlock_score = score
    elif unlock is not None:
        unlock_kind = "matched"
        unlock_score = len(DA_VINCI_CODEX)
    else:
        unlock, unlock_kind = None, "sealed"
        unlock_score = 0

    anchor = vitruvian or samples[-1]
    c = anchor["coherence"]
    s = anchor["stability"]
    r = resonance(anchor["t"], c)
    sequence = unlock or list(DA_VINCI_CODEX)
    evolved = _evolve(sequence)
    return {
        "mode": "symbolic",
        "disclosure": DISCLOSURE,
        "seed": str(seed if seed is not None else "voidai")[:120],
        "steps": steps,
        "attempts_per_step": attempts,
        "vitruvian": vitruvian,
        "unlock_kind": unlock_kind,
        "unlock_score": unlock_score,
        "sequence": sequence,
        "meaning": [SYMBOL_MEANINGS.get(sym, "no mapping defined") for sym in sequence],
        "deterministic_evolution": evolved,
        "evolved_meaning": [SYMBOL_MEANINGS.get(sym, "no mapping defined") for sym in evolved],
        "portal": _portal(c, s),
        "veil": _veil(c, s),
        "energy": _energy(c, r),
        "voxels": _voxels(sequence),
        "samples": samples,
        "anchor": anchor,
    }


def is_relevant(text):
    """True when a message asks for the symbolic vortex layer."""
    return bool(VORTEX_RE.search(str(text or "")[:4000]))


def prompt_context(text, user=None):
    """Small system-context block injected only for vortex-related messages."""
    if not is_relevant(text):
        return ""
    packet = snapshot(seed="%s:%s" % (user or "guest", str(text)[:200]), steps=24, attempts=4)
    return "\n".join([
        "PHB GOD-CODE VORTEX (symbolic context):",
        "- This layer is symbolic geometry, not physics or consciousness.",
        "- coherence %.2f; stability %.2f; portal %s; veil %s; energy %s." % (
            packet["anchor"]["coherence"], packet["anchor"]["stability"],
            packet["portal"], packet["veil"]["phase"], packet["energy"]["band"],
        ),
        "- sequence: " + " ".join(packet["sequence"]),
        "- Use symbols as metaphors. Do not claim measurements or real effects.",
    ])


def format_report(packet):
    """Render a packet for the CLI or command reply."""
    lines = [
        "**PHB God-Code Vortex** (symbolic)",
        "- aliases: @vortex, @godcode, @codex (same packet)",
        "- coherence: %.3f" % packet["anchor"]["coherence"],
        "- stability: %.3f" % packet["anchor"]["stability"],
        "- vitruvian: " + (
            "t=%.1f" % packet["vitruvian"]["t"] if packet["vitruvian"] else "not crossed"
        ),
        "- unlock: %s (%d/7)" % (packet["unlock_kind"], packet["unlock_score"]),
        "- sequence: " + " ".join(packet["sequence"]),
        "- portal: " + packet["portal"],
        "- veil: %s (%.2f)" % (packet["veil"]["phase"], packet["veil"]["thickness"]),
        "- energy: %s (%.3f)" % (packet["energy"]["band"], packet["energy"]["magnitude"]),
        "",
        "Evolution: " + " ".join(packet["deterministic_evolution"]),
        "",
        "No timestamp or version field; this is a deterministic symbolic snapshot.",
        packet["disclosure"],
    ]
    return "\n".join(lines)


def command(arg="", user=None):
    """Handle @vortex / @godcode / @codex commands."""
    arg = str(arg or "").strip()[:200]
    packet = snapshot(seed="%s:%s" % (user or "guest", arg or "state"))
    report = format_report(packet)
    if arg.lower().startswith("evolve"):
        report += "\n\nEvolved symbols: " + ", ".join(packet["evolved_meaning"])
    if arg.lower().startswith("scan"):
        report += "\n\nVortex trigger words are recognized in normal chat; no network or shell is used."
    return report


__all__ = (
    "DA_VINCI_CODEX", "SYMBOL_MEANINGS", "DISCLOSURE", "snapshot",
    "is_relevant", "prompt_context", "format_report", "command",
)
