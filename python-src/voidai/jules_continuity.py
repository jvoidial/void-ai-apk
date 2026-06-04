import time
from collections import defaultdict

class ContinuityEngine:
    def __init__(self):
        self.threads = defaultdict(list)  # topic -> list of voxels

    def _topic_from_concepts(self, concepts):
        if not concepts:
            return "general"
        return concepts[0].lower()

    def add_voxel(self, concepts, kind, text):
        topic = self._topic_from_concepts(concepts)
        voxel = {
            "ts": int(time.time()),
            "kind": kind,
            "text": text,
            "concepts": concepts,
        }
        self.threads[topic].append(voxel)
        if len(self.threads[topic]) > 50:
            self.threads[topic] = self.threads[topic][-50:]
        return topic, voxel

    def continuity_view(self, topic):
        voxels = self.threads.get(topic.lower(), [])
        if not voxels:
            return f"No continuity thread yet for '{topic}'."
        lines = [f"Continuity thread for '{topic}':"]
        for v in voxels[-10:]:
            lines.append(f"- [{v['kind']}] {v['text']}")
        return "\n".join(lines)

    def global_coherence(self):
        out = ["Global continuity overview:"]
        for topic, voxels in self.threads.items():
            out.append(f"- {topic}: {len(voxels)} voxels")
        return "\n".join(out)

JULES = ContinuityEngine()
