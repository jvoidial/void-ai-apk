#!/usr/bin/env python3
"""
Connectome Brain Analyzer for VOID AI APK
"""
import os
import csv
import urllib.request
from io import StringIO
from pathlib import Path

DATASETS = [
    "ds000212", "ds000224", "ds000117", "ds000102",
    "ds000109", "ds000110", "ds000120", "ds000122",
    "ds000138", "ds000157", "ds000168", "ds000171",
    "ds000210", "ds000214", "ds000217", "ds000220",
    "ds000229", "ds000231", "ds000233", "ds000235",
    "ds000238", "ds000240", "ds000243", "ds000254",
]


def _data_dir():
    try:
        from . import config
        base = config.home()
    except Exception:
        base = Path(os.environ.get("VOIDAI_HOME", "~/.local/share/voidai")).expanduser()
    path = Path(base) / "brains"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _get_text(url, timeout=15):
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "VOIDAI/0.2"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", "replace")
    except Exception:
        return None


class BrainAnalyzer:
    def __init__(self, dataset_id: str = None):
        self.dataset_id = dataset_id or "ds000243"

    def download_tsv(self, ds_id: str) -> str:
        url = f"https://openneuro.org/crn/datasets/{ds_id}/files/participants.tsv"
        text = _get_text(url)
        if text and 'participant_id' in text[:100]:
            return text
        return None

    def parse_tsv(self, content: str) -> list:
        reader = csv.DictReader(StringIO(content), delimiter='\t')
        headers = reader.fieldnames
        age_col = next((c for c in headers if c.lower() in ["age", "age_in_years"]), None)
        sex_col = next((c for c in headers if c.lower() in ["sex", "gender", "participant_sex"]), None)
        if not age_col or not sex_col:
            return []
        matches = []
        for row in reader:
            age_str = row.get(age_col, '').strip()
            sex = row.get(sex_col, '').upper()
            if age_str == 'n/a' or age_str == '':
                continue
            try:
                age = float(age_str)
            except:
                continue
            if sex == 'F' and 18 <= age <= 25:
                matches.append(row)
        return matches

    def download_connectome(self, ds_id: str) -> str:
        filenames = [
            "connectome.graphml", "connectivity.graphml", "network.graphml",
            "connectome.csv", "connectivity.csv",
        ]
        for fname in filenames:
            url = f"https://openneuro.org/crn/datasets/{ds_id}/files/{fname}"
            text = _get_text(url, timeout=10)
            if text and not text.startswith('<!DOCTYPE'):
                target = _data_dir() / fname
                with open(target, 'w') as f:
                    f.write(text)
                return str(target)
        return None

    def analyze_graph(self, filename: str) -> dict:
        try:
            import networkx as nx
            if filename.endswith(".graphml"):
                G = nx.read_graphml(filename)
            elif filename.endswith(".csv"):
                import pandas as pd
                df = pd.read_csv(filename, index_col=0)
                G = nx.from_pandas_adjacency(df)
            else:
                return {"error": "Unsupported format"}
            deg = dict(G.degree())
            avg_deg = sum(deg.values()) / G.number_of_nodes() if G.number_of_nodes() else 0
            hubs = sorted(deg.items(), key=lambda x: x[1], reverse=True)[:5]
            return {
                "nodes": G.number_of_nodes(),
                "edges": G.number_of_edges(),
                "avg_degree": round(avg_deg, 2),
                "top_hubs": hubs
            }
        except Exception as e:
            return {"error": str(e)}

    def scan(self) -> dict:
        results = {}
        for ds_id in DATASETS:
            print(f"   Scanning {ds_id}...")
            tsv = self.download_tsv(ds_id)
            if not tsv:
                continue
            matches = self.parse_tsv(tsv)
            if not matches:
                continue
            print(f"      ✅ Found {len(matches)} female 18-25 participants.")
            conn = self.download_connectome(ds_id)
            if conn:
                print(f"      📁 Downloaded connectome: {conn}")
                analysis = self.analyze_graph(conn)
                results[ds_id] = {
                    "participants": len(matches),
                    "connectome": conn,
                    "analysis": analysis
                }
                os.remove(conn)
                return results
            else:
                print("      ⚠️ No connectome found.")
        return results

    def get_brain_summary(self, ds_id: str = None) -> dict:
        ds_id = ds_id or self.dataset_id
        tsv = self.download_tsv(ds_id)
        if not tsv:
            return {"error": f"No participants.tsv for {ds_id}"}
        matches = self.parse_tsv(tsv)
        return {
            "dataset": ds_id,
            "female_18_25_count": len(matches),
            "sample_participants": matches[:3]
        }
