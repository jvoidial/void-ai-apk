import re
from .memory_mesh import classify

class KnowledgeGraph:
    def __init__(self):
        self.nodes = {}   # id -> {label, kind}
        self.edges = []   # {src, dst, rel}

    def _node_id(self, label, kind):
        return f"{kind}:{label.lower()}"

    def add_concept(self, label, kind="concept"):
        nid = self._node_id(label, kind)
        if nid not in self.nodes:
            self.nodes[nid] = {"label": label, "kind": kind}
        return nid

    def add_relation(self, src_label, rel, dst_label, src_kind="concept", dst_kind="concept"):
        s = self.add_concept(src_label, src_kind)
        d = self.add_concept(dst_label, dst_kind)
        self.edges.append({"src": s, "rel": rel, "dst": d})
        return {"src": s, "rel": rel, "dst": d}

    def neighbors(self, label):
        nid = None
        for k, v in self.nodes.items():
            if v["label"].lower() == label.lower():
                nid = k
                break
        if not nid:
            return []
        out = []
        for e in self.edges:
            if e["src"] == nid:
                out.append({"direction": "out", "rel": e["rel"], "to": self.nodes[e["dst"]]["label"]})
            if e["dst"] == nid:
                out.append({"direction": "in", "rel": e["rel"], "from": self.nodes[e["src"]]["label"]})
        return out

KG = KnowledgeGraph()

def extract_concepts(text: str):
    words = re.findall(r"[A-Za-z_]{3,}", text)
    return list(dict.fromkeys(words))[:10]

def ingest(text: str):
    kind = classify(text)
    concepts = extract_concepts(text)
    last = None
    for c in concepts:
        nid = KG.add_concept(c, kind="concept")
        if last:
            KG.add_relation(last, "related_to", c)
        last = c
    if kind == "code":
        KG.add_relation("code", "mentions", concepts[0] if concepts else "snippet", src_kind="meta", dst_kind="concept")
    return {"kind": kind, "concepts": concepts}

def summarize_focus(term: str):
    neigh = KG.neighbors(term)
    if not neigh:
        return f"No strong knowledge links yet around '{term}'."
    lines = [f"Knowledge links around '{term}':"]
    for n in neigh[:10]:
        if n["direction"] == "out":
            lines.append(f"- {term} --{n['rel']}--> {n['to']}")
        else:
            lines.append(f"- {n['from']} --{n['rel']}--> {term}")
    return "\n".join(lines)
