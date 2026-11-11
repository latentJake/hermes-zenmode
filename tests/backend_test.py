#!/usr/bin/env python3
"""Backend contract test: the real dispatcher (plugin_api.py) + real zed_backend.py over your
real state.db, called the way the desktop app calls it, INCLUDING the query params the app adds
on its own (`profile`). Run by scripts/test.sh with the Hermes venv's python."""
import sys
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(Path.home() / ".hermes/hermes-agent"), str(repo / "dashboard")]

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_api  # noqa: E402

app = FastAPI()
app.include_router(plugin_api.router, prefix="/api/plugins/zedmode")
c = TestClient(app)
P = "/api/plugins/zedmode"
fails = 0


def ok(cond, msg):
    global fails
    print(("  ✓ " if cond else "  ✗ ") + msg)
    fails += not cond


print("backend (dispatcher + zed_backend, real state.db)")
r = c.get(f"{P}/health?profile=default")
ok(r.status_code == 200 and r.json().get("status") == "ok", f"/health with the app's ?profile= → {r.status_code}")
r = c.get(f"{P}/zed?profile=default")
ok(r.status_code == 200 and {"pinned", "recent", "folders"} <= set(r.json()), f"/zed with ?profile= → {r.status_code}")
z = r.json() if r.status_code == 200 else {}
sid = next((x["id"] for x in z.get("recent", []) + z.get("pinned", [])), None)
if sid:
    r = c.get(f"{P}/session", params={"id": sid, "profile": "default"})
    ok(r.status_code == 200 and "turns" in r.json(), f"/session with ?profile= → {r.status_code}")
if z.get("folders"):
    r = c.get(f"{P}/folder", params={"path": z["folders"][0]["path"], "profile": "default"})
    ok(r.status_code == 200 and "sessions" in r.json(), f"/folder with ?profile= → {r.status_code}")
ok(len(z.get("all", [])) >= len(z.get("recent", [])) and all("last" in x for x in z.get("all", [])), f"/zed lists the whole history ({len(z.get('all', []))} conversations)")
if sid:
    r = c.get(f"{P}/prompts", params={"ids": sid, "profile": "default"})
    pl = (r.json().get("prompts") or {}).get(sid) if r.status_code == 200 else None
    ok(bool(pl) and pl[0]["n"] >= pl[-1]["n"] and len(pl) <= 6 and all(len(x["text"]) <= 220 and "\n" not in x["text"] for x in pl),
       f"/prompts: latest first, one line each ({len(pl or [])} for one chat, newest is #{pl[0]['n'] if pl else '?'})")
    ok(not any("--- Attached Context ---" in x["text"] for x in pl or []), "/prompts drops the context the gateway appended")
ids = ",".join(x["id"] for x in z.get("all", [])[:8])
if ids:
    import time as _t

    _zb = plugin_api._impl()  # the module the dispatcher actually serves

    _zb._GLANCE_SCHEMA = int(_t.time())  # a schema nobody has cached: the first call must derive
    _zb._mem_cache.clear()
    t0 = _t.perf_counter(); r1 = c.get(f"{P}/glance", params={"ids": ids, "profile": "default"}); cold = (_t.perf_counter() - t0) * 1000
    t0 = _t.perf_counter(); r2 = c.get(f"{P}/glance", params={"ids": ids, "profile": "default"}); warm = (_t.perf_counter() - t0) * 1000
    g1, g2 = r1.json(), r2.json()
    n = len(ids.split(","))
    one = next(iter(g1.get("glance", {}).values()), {})
    ok(r1.status_code == 200 and len(g1["glance"]) == n and {"prompts", "tools", "files", "kinds", "diff", "activeMin", "repo", "branch", "model", "cost", "tokens"} <= set(one),
       f"/glance: {n} conversations in one call, session facts + derived facts")
    ok(g1["cached"] == [] and len(g2["cached"]) == n and g1["glance"] == g2["glance"], f"/glance derives once, then serves from the cache (cold {cold:.0f} ms → warm {warm:.0f} ms)")
    _zb._mem_cache.clear()
    ok(len(c.get(f"{P}/glance", params={"ids": ids}).json()["cached"]) == n, "the cache survives a restart (read back from our own cache.db)")
    con = _zb._ro()
    try:
        con.execute("UPDATE sessions SET title = title WHERE 0")
        wrote = True
    except Exception:
        wrote = False
    finally:
        con.close()
    ok(not wrote, "the Hermes database connection refuses writes (read-only + query_only)")
    ok(c.get(f"{P}/glance", params={"ids": "nope'; DROP TABLE sessions;--"}).json()["glance"] == {}, "ids are bound parameters: a hostile id is just an unknown id")
import json as _json

r = c.get(f"{P}/usable", params={"pairs": _json.dumps([["no-such-provider-xyz", "some-model"]]), "profile": "default"})
v = (r.json().get("providers") or {}).get("no-such-provider-xyz") if r.status_code == 200 else None
ok(bool(v) and v["ok"] is False and bool(v["reason"]), f"/usable: a provider Hermes cannot resolve comes back not usable, with the reason ({(v or {}).get('reason', '')[:60]}…)")
ok(c.get(f"{P}/usable", params={"pairs": "not json"}).json() == {"providers": {}}, "/usable ignores malformed input")
ok(c.get(f"{P}/session?profile=default").status_code == 400, "/session without id → 400")
ok(c.get(f"{P}/nope").status_code == 404, "unknown route → 404")
sys.exit(1 if fails else 0)
