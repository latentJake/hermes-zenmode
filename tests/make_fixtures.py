#!/usr/bin/env python3
"""Dump real backend responses (from your state.db) as test fixtures for tests/harness.mjs."""
import asyncio, json, sys
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
agent = Path.home() / ".hermes/hermes-agent"
sys.path[:0] = [str(agent), str(repo / "dashboard")]
import zed_backend as p  # noqa: E402

out = Path(sys.argv[1])
zed = asyncio.run(p.zed())
sessions = {}
for c in zed["recent"] + zed["pinned"] + [f["latest"] for f in zed["folders"]]:
    sessions[c["id"]] = asyncio.run(p.session(c["id"]))
folders = {f["path"]: asyncio.run(p.folder(f["path"])) for f in zed["folders"]}
for fo in folders.values():
    for c in fo["sessions"]:
        sessions.setdefault(c["id"], asyncio.run(p.session(c["id"])))
out.write_text(json.dumps({"zed": zed, "sessions": sessions, "folders": folders}, default=str))
print(f"fixtures: {len(zed['recent'])} recent, {len(zed['folders'])} folders, {len(sessions)} sessions")
