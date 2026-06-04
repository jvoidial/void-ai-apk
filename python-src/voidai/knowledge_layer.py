import re
from collections import defaultdict
from .memory_mesh import classify

class KnowledgeGraph:
    def __init__(self):
        self.nodes = {}
        self.edges = []

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

    def map_view(self):
        clusters = defaultdict(list)
        for nid, data in self.nodes.items():
            clusters[data["kind"]].append(data["label"])

        degrees = defaultdict(int)
        for e in self.edges:
            degrees[e["src"]] += 1
            degrees[e["dst"]] += 1

        important = sorted(
            [(self.nodes[n]["label"], deg) for n, deg in degrees.items()],
            key=lambda x: -x[1]
        )[:10]

        return {
            "clusters": dict(clusters),
            "important": important,
            "edge_count": len(self.edges),
            "node_count": len(self.nodes)
        }

KG = KnowledgeGraph()

def extract_concepts(text: str):
    words = re.findall(r"[A-Za-z_]{3,}", text)
    return list(dict.fromkeys(words))[:10]

def ingest(text: str):
    kind = classify(text)
    concepts = extract_concepts(text)
    last = None
    for c in concepts:
        KG.add_concept(c)
        if last:
            KG.add_relation(last, "related_to", c)
        last = c
    return {"kind": kind, "concepts": concepts}

def summarize_focus(term: str):
    neigh = KG.neighbors(term)
    if not neigh:
        return f"No knowledge links yet around '{term}'."
    lines = [f"Knowledge links around '{term}':"]
    for n in neigh[:20]:
        if n["direction"] == "out":
            lines.append(f"- {term} --{n['rel']}--> {n['to']}")
        else:
            lines.append(f"- {n['from']} --{n['rel']}--> {term}")
    return "\n".join(lines)

def summarize_map():
    mv = KG.map_view()
    out = []
    out.append(f"Knowledge Graph Overview:")
    out.append(f"- Nodes: {mv['node_count']}")
    out.append(f"- Edges: {mv['edge_count']}")
    out.append("\nClusters:")
    for k, v in mv["clusters"].items():
        out.append(f"  {k}: {', '.join(v[:10])}")
    out.append("\nMost connected concepts:")
    for label, deg in mv["important"]:
        out.append(f"  {label} (degree {deg})")
    return "\n".join(out)
