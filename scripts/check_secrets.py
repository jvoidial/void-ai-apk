#!/usr/bin/env python3
"""Fail when tracked files contain credential-shaped strings.

This is a focused, dependency-free guard for the common leaked-token formats.
It prints only the file, line, and rule name; it never prints the matched value.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

RULES = {
    "github-token": re.compile(r"\b(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})\b"),
    "openai-token": re.compile(r"\bsk-(?:proj-|svcacct-|admin-|[A-Za-z0-9])[A-Za-z0-9_-]{20,}\b"),
    "anthropic-token": re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b"),
    "google-api-key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "aws-access-key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "slack-token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    "stripe-live-key": re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b"),
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    "secret-assignment": re.compile(
        r"(?i)\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|"
        r"service[_-]?role[_-]?key)\b\s*[:=]\s*[\"'](?!(?:voidai_|sb_publishable_))"
        r"[A-Za-z0-9._~+/-]{24,}[\"']"
    ),
}

# These are intentionally public client identifiers, not provider credentials.
ALLOWED_PREFIXES = ("voidai_", "sb_publishable_")


def tracked_files() -> list[Path]:
    raw = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True).stdout
    return [Path(item) for item in raw.decode().split("\0") if item]


def main() -> int:
    findings: list[tuple[str, int, str]] = []
    for path in tracked_files():
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:4096]:
            continue
        text = data.decode("utf-8", "replace")
        for line_number, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if any(prefix in stripped for prefix in ALLOWED_PREFIXES):
                continue
            for name, pattern in RULES.items():
                if pattern.search(line):
                    findings.append((str(path), line_number, name))
    if findings:
        print("Potential secrets found (values intentionally hidden):")
        for path, line, name in findings:
            print(f"  {path}:{line} [{name}]")
        print("Remove the value, rotate the credential, and use environment/secrets storage.")
        return 1
    print("No credential-shaped strings found in tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
