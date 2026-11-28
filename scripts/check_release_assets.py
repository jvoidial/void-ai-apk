#!/usr/bin/env python3
"""Verify release assets and fail on provider credentials.

Usage:
    python3 scripts/check_release_assets.py downloads/
    python3 scripts/check_release_assets.py app.apk app.ipa app.apk.sha256

The scan prints only the asset and rule name, never the matched value.
"""

from __future__ import annotations

import hashlib
import re
import sys
import zipfile
from pathlib import Path

RULES = {
    "github-pat": re.compile(rb"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    "github-token": re.compile(rb"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    "groq-key": re.compile(rb"\bgsk_[A-Za-z0-9]{20,}"),
    "openai-key": re.compile(rb"\bsk-(?:proj-|svcacct-|admin-|ant-|[A-Za-z0-9])[A-Za-z0-9_-]{20,}"),
    "openrouter-key": re.compile(rb"\bsk-or-v1-[A-Za-z0-9]{20,}"),
    "google-api-key": re.compile(rb"\bAIza[0-9A-Za-z_-]{35}"),
    "aws-access-key": re.compile(rb"\bAKIA[0-9A-Z]{16}"),
    "slack-token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    "huggingface-token": re.compile(rb"\bhf_[A-Za-z0-9]{20,}"),
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}

CHECKSUM_LINE = re.compile(r"^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$")


def collect(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            files.extend(p for p in path.rglob("*") if p.is_file())
        elif path.is_file():
            files.append(path)
    return sorted(files)


def verify_checksum(sidecar: Path, findings: list[tuple[str, str]]) -> None:
    for line in sidecar.read_text(encoding="utf-8", errors="replace").splitlines():
        match = CHECKSUM_LINE.match(line)
        if not match:
            continue
        expected, name = match.groups()
        target = sidecar.parent / name
        if not target.is_file():
            findings.append((str(sidecar), "checksum-target-missing"))
            continue
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        if actual.lower() != expected.lower():
            findings.append((str(sidecar), "checksum-mismatch"))


def scan_bytes(label: str, data: bytes, findings: list[tuple[str, str]]) -> None:
    for name, pattern in RULES.items():
        if pattern.search(data):
            findings.append((label, name))


def scan_file(path: Path, findings: list[tuple[str, str]]) -> None:
    if path.name.endswith(".sha256"):
        verify_checksum(path, findings)
        return
    if path.suffix.lower() in {".apk", ".ipa", ".zip", ".jar"}:
        try:
            with zipfile.ZipFile(path) as archive:
                for entry in archive.infolist():
                    if entry.is_dir() or entry.file_size > 20_000_000:
                        continue
                    scan_bytes(f"{path}:{entry.filename}", archive.read(entry), findings)
        except zipfile.BadZipFile:
            findings.append((str(path), "invalid-zip"))
        return
    scan_bytes(str(path), path.read_bytes(), findings)


def main() -> int:
    paths = sys.argv[1:]
    if not paths:
        print("usage: check_release_assets.py <file-or-directory> [...]", file=sys.stderr)
        return 2
    files = collect(paths)
    if not files:
        print("no release assets found", file=sys.stderr)
        return 2
    findings: list[tuple[str, str]] = []
    for path in files:
        scan_file(path, findings)
    if findings:
        print("Release asset check failed (values intentionally hidden):")
        for label, rule in findings:
            print(f"  {label} [{rule}]")
        return 1
    print(f"Release assets clean: {len(files)} file(s) checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
