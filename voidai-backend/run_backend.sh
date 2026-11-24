#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
exec python3 server.py
