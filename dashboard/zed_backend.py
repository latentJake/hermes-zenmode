"""Zed Mode backend logic (reloaded on change by plugin_api.py — no gateway restart needed).

Mounted by the gateway at /api/plugins/zedmode/ once `zedmode` is in
`plugins.enabled` (config.yaml). The desktop half calls it with ctx.rest('/zed').

Data rules (docs/architecture.md, "The data half"):
  1. Hermes' databases are opened READ-ONLY (`mode=ro` + `query_only`), with bound parameters.
     Nothing here can write to state.db, whatever a route is asked.
  2. Use what Hermes already stores before deriving anything: the session row carries the title,
     model, cwd, git root / branch, message / tool-call counts, tokens, cost and activity times.
  3. Anything derived from a transcript (prompts, files touched, diff size, active time) is
     computed once and kept in OUR OWN cache file, keyed by the session's revision, so a card
     costs one indexed lookup until that conversation changes.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path

VERSION = "0.19.0"
WEEK = 7 * 24 * 3600


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home  # profile-aware inside the gateway

        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


# Session sources Hermes itself keeps out of its own session list (the same three its sidebar
# hides). Listed here rather than imported, so the backend stays on Hermes' public surface.
_INTERNAL_SOURCES = frozenset({"kanban", "tool", "oneshot"})


def _internal_sources() -> set[str]:
    return set(_INTERNAL_SOURCES)


def _rows(limit: int = 2000) -> list[dict]:
    """Same listing the sidebar uses (branches count as their own conversation,
    compression segments fold into their tip, pins back-filled past the limit)."""
    from hermes_state import SessionDB

    db = SessionDB(_home() / "state.db")
    try:
        rows = db.list_sessions_rich(
            source=None, limit=limit, order_by_last_active=True, compact_rows=True,
            include_pinned=True, min_message_count=1,
        )
    finally:
        db.close()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "title": r.get("title") or "", "source": r.get("source") or "",
            "model": r.get("model"), "last": r.get("last_active") or r.get("started_at") or 0,
            "message_count": r.get("message_count") or 0, "pinned": bool(r.get("pinned")),
            "cwd": r.get("cwd"), "git_repo_root": r.get("git_repo_root"),
            "git_branch": r.get("git_branch"), "preview": r.get("preview") or "",
        })
    return out


def _key(r: dict) -> str:
    """Dedup key: two sessions with the same title/opening line count as one."""
    text = (r["title"] or r["preview"] or "").lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()[:80] or r["id"]


def _card(r: dict) -> dict:
    preview = " ".join((r["preview"] or "").split())
    return {
        "id": r["id"],
        "title": r["title"] or preview[:70] or "Untitled",
        "preview": preview,
        "source": r["source"],
        "model": r["model"],
        "last": r["last"],
        "message_count": r["message_count"],
        "pinned": bool(r["pinned"]),
        "root": r["git_repo_root"] or r["cwd"] or None,
    }


async def health() -> dict:
    return {"plugin": "zedmode", "status": "ok", "version": VERSION}


async def zed(recent: int = 3, folders: int = 3, pinned: int = 12) -> dict:
    recent, folders, pinned = (max(1, min(20, int(n))) for n in (recent, folders, pinned))
    deny = _internal_sources()
    rows = [r for r in _rows() if r["source"].lower() not in deny]

    pinned_cards = [_card(r) for r in rows if r["pinned"]][:pinned]
    all_cards = [_card(r) for r in rows]  # the whole history, newest first: the back of the Zed Mode stack

    # Most recent unique conversations from the last 7 days (pins excluded: they have their own stack).
    cutoff, seen, recent_cards = time.time() - WEEK, set(), []
    for r in rows:
        if r["pinned"] or r["last"] < cutoff:
            continue
        k = _key(r)
        if k in seen:
            continue
        seen.add(k)
        recent_cards.append(_card(r))
        if len(recent_cards) >= recent:
            break

    # Most recently used project roots: git repo root when known, else the working dir.
    by_root: dict[str, dict] = {}
    for r in rows:
        root = r["git_repo_root"] or r["cwd"]
        if not root:
            continue
        f = by_root.get(root)
        if f is None:
            by_root[root] = f = {
                "path": root,
                "name": Path(root).name or root,
                "last": r["last"],
                "sessions": 0,
                "branch": r["git_branch"],
                "latest": _card(r),  # rows are newest-first, so the first hit is the latest
            }
        f["sessions"] += 1
    folder_cards = sorted(by_root.values(), key=lambda f: f["last"], reverse=True)[:folders]
    for f in folder_cards:
        f["exists"] = Path(f["path"]).is_dir()

    return {
        "version": VERSION,
        "generated_at": time.time(),
        "home": str(Path.home()),
        "pinned": pinned_cards,
        "all": all_cards,
        "recent": recent_cards,
        "folders": folder_cards,
    }


# ── "hold" views: Shift+Return in Zed Mode zooms into a card without leaving Zed Mode ──

def _text(content) -> str:
    """Message content as plain text (content can be a string or a list of parts)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n].rstrip() + "\n\n…"


_ARG_KEYS = ("command", "path", "file_path", "query", "url", "pattern", "name", "prompt", "text")


def _arg_preview(raw) -> str:
    """One readable line for a tool call: its command / path / query, else the first string arg."""
    import json

    try:
        args = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except Exception:
        return " ".join(str(raw).split())[:140]
    if not isinstance(args, dict):
        return ""
    for k in _ARG_KEYS:
        if isinstance(args.get(k), str) and args[k].strip():
            return " ".join(args[k].split())[:140]
    for v in args.values():
        if isinstance(v, str) and v.strip():
            return " ".join(v.split())[:140]
    return ""


async def session(id: str, turns: int = 40) -> dict:
    """One conversation as TURNS (a user message + everything until the next user message),
    newest last. Each turn keeps its STEPS in order: assistant text and tool calls
    (name + a one-line argument preview), so Zed Mode can show what the agent did between prompts."""
    from hermes_state import SessionDB

    turns = max(1, min(200, int(turns)))
    db = SessionDB(_home() / "state.db")
    try:
        meta = db.get_session(id) if hasattr(db, "get_session") else None
        msgs = db.get_messages(id, include_ancestors=True)
    finally:
        db.close()

    out: list[dict] = []
    by_call: dict[str, dict] = {}  # tool_call_id → its step, so a result can attach its diff
    for m in msgs:
        role, text = m.get("role"), _text(m.get("content")).strip()
        if role == "user":
            out.append({"user": _clip(text, 4000), "assistant": [], "tools": [], "steps": [], "ts": m.get("timestamp")})
            continue
        if not out:  # assistant/tool before any user message (system-started chats)
            out.append({"user": "", "assistant": [], "tools": [], "steps": [], "ts": m.get("timestamp")})
        t = out[-1]
        if role == "assistant":
            if text:
                t["assistant"].append(text)
                t["steps"].append({"k": "text", "text": _clip(text, 6000)})
            for call in m.get("tool_calls") or []:
                fn = (call.get("function") or {}) if isinstance(call, dict) else {}
                if fn.get("name"):
                    t["tools"].append(fn["name"])
                    step = {"k": "tool", "name": fn["name"], "arg": _arg_preview(fn.get("arguments"))}
                    t["steps"].append(step)
                    if call.get("id"):
                        by_call[call["id"]] = step
        elif role == "tool" and m.get("tool_call_id") in by_call:
            step = by_call[m["tool_call_id"]]
            if step["name"] in ("patch", "write_file", "edit_file", "apply_patch"):
                try:
                    import json

                    diff = json.loads(m.get("content") or "{}").get("diff")
                    if isinstance(diff, str) and diff:
                        step["diff"] = diff[:20000]
                except Exception:
                    pass

    for t in out:
        t["assistant"] = _clip("\n\n".join(t["assistant"]), 8000)
        t["steps"] = t["steps"][-80:]  # very long agent runs: keep the tail
    meta = dict(meta) if meta else {}
    return {
        "id": id,
        "title": meta.get("title") or "",
        "source": meta.get("source") or "",
        "model": meta.get("model") or "",
        "cwd": meta.get("cwd") or "",
        "total_turns": len(out),
        "turns": out[-turns:],
    }


def _prompt_line(content) -> str:
    """One readable line for a user prompt: its own words, without the context the gateway appended."""
    import json

    if isinstance(content, str) and content[:1] in "[{":
        try:
            content = json.loads(content)
        except Exception:
            pass
    text = _text(content) if not isinstance(content, dict) else str(content.get("text") or "")
    for marker in ("\n\n--- Attached Context ---", "\n\n--- Context Warnings ---"):
        text = text.split(marker, 1)[0]
    text = " ".join(text.split())
    return text if len(text) <= 220 else text[:219].rstrip() + "…"


async def prompts(ids: str, n: int = 6) -> dict:
    """The latest user prompts of each conversation, newest first: what a Zed Mode card lists.
    `n` is the prompt's number within its conversation. Read straight from state.db, read-only."""
    n = max(1, min(20, int(n)))
    wanted = [i for i in (ids or "").split(",") if i][:40]
    out: dict[str, list[dict]] = {}
    con = _ro()
    try:
        for sid in wanted:
            total = con.execute("select count(*) from messages where session_id = ? and role = 'user'", (sid,)).fetchone()[0]
            rows = con.execute(
                "select content from messages where session_id = ? and role = 'user' order by id desc limit ?", (sid, n)
            ).fetchall()
            lines = [{"n": total - i, "text": _prompt_line(row[0])} for i, row in enumerate(rows)]
            out[sid] = [line for line in lines if line["text"]]
    finally:
        con.close()
    return {"prompts": out}


# ── glance: what a card shows, from data Hermes already has + a derived cache ──

_SESSION_COLS = (
    "id, title, source, model, cwd, git_repo_root, git_branch, message_count, tool_call_count, "
    "input_tokens, output_tokens, estimated_cost_usd, started_at, last_activity_at, "
    "last_activity_description, transcript_revision, pinned"
)
# File markers → the app a session was working in (first match wins; easy to extend).
_APPS = (
    ("GameMaker", (".yyp", ".gml", ".yy")), ("Blender", (".blend",)), ("Xcode", (".xcodeproj", ".swift")),
    ("Godot", (".tscn", ".gd")), ("Node", ("package.json", ".ts", ".tsx", ".js", ".mjs")),
    ("Python", ("pyproject.toml", ".py")), ("Rust", ("Cargo.toml", ".rs")),
)
_TEXTLIKE = (".md", ".txt", ".json", ".yaml", ".yml", ".toml")
_WRITE_TOOLS = ("write_file", "patch", "edit_file", "apply_patch")
_GLANCE_SCHEMA = 2  # bump to throw away every cached entry


def _ro(db: str = "state.db"):
    """A connection that cannot write: read-only URI and query_only, short busy timeout.
    state.db runs in WAL mode, so readers never block the gateway's writes."""
    import sqlite3

    con = sqlite3.connect(f"file:{_home() / db}?mode=ro", uri=True, timeout=2)
    con.execute("PRAGMA query_only = 1")
    con.row_factory = sqlite3.Row
    return con


_mem_cache: dict[str, tuple[str, dict]] = {}


def _cache_db():
    """Our own small cache (never Hermes' files): $HERMES_HOME/plugin-data/zedmode/cache.db.
    Returns None if it can't be opened; the in-memory cache still works then."""
    import sqlite3

    try:
        d = _home() / "plugin-data" / "zedmode"
        d.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(d / "cache.db", timeout=2)
        con.execute("PRAGMA journal_mode = WAL")
        con.execute("CREATE TABLE IF NOT EXISTS glance (id TEXT PRIMARY KEY, rev TEXT NOT NULL, data TEXT NOT NULL, at REAL NOT NULL)")
        return con
    except Exception:
        return None


def _kind(path: str) -> tuple[str, str | None]:
    name = Path(path).name
    ext = Path(path).suffix.lower()
    for app, marks in _APPS:
        if name in marks or ext in marks:
            return (ext or name), app
    return (ext or name or "file"), None


def _derive(con, sid: str) -> dict:
    """Everything a card needs that the session row doesn't hold. One pass over the transcript."""
    import json

    prompts, tools, written, read = [], {}, {}, {}
    add = rem = 0
    active = 0.0
    last_ts = None
    n_user = 0
    rows = con.execute(
        "SELECT role, content, tool_calls, tool_name, timestamp FROM messages WHERE session_id = ? ORDER BY id", (sid,)
    )
    for m in rows:
        ts = m["timestamp"]
        if last_ts is not None and ts and 0 < ts - last_ts < 600:
            active += ts - last_ts  # gaps under 10 minutes count as working time
        last_ts = ts or last_ts
        role = m["role"]
        if role == "user":
            n_user += 1
            line = _prompt_line(m["content"])
            if line:
                prompts.append({"n": n_user, "text": line})
        elif role == "assistant" and m["tool_calls"]:
            try:
                calls = json.loads(m["tool_calls"])
            except Exception:
                calls = []
            for c in calls if isinstance(calls, list) else []:
                fn = (c.get("function") or {}) if isinstance(c, dict) else {}
                name = fn.get("name") or "tool"
                tools[name] = tools.get(name, 0) + 1
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}
                path = args.get("path") or args.get("file_path") if isinstance(args, dict) else None
                if isinstance(path, str) and path:
                    (written if name in _WRITE_TOOLS else read)[path] = True
        elif role == "tool" and m["tool_name"] in _WRITE_TOOLS and m["content"]:
            try:
                diff = json.loads(m["content"]).get("diff")
            except Exception:
                diff = None
            if isinstance(diff, str):
                for ln in diff.split("\n"):
                    if ln.startswith("+") and not ln.startswith("+++"):
                        add += 1
                    elif ln.startswith("-") and not ln.startswith("---"):
                        rem += 1

    kinds: dict[str, dict] = {}
    for path in {**read, **written}:
        k, app = _kind(path)
        e = kinds.setdefault(app or k, {"kind": k, "label": app or k.lstrip("."), "count": 0, "app": app})
        e["count"] += 1
    # app badges first, then code / media / data, text-like kinds last; bigger counts first within each
    order = sorted(kinds.values(), key=lambda e: (0 if e["app"] else 2 if e["kind"] in _TEXTLIKE else 1, -e["count"]))
    return {
        "prompts": prompts[-6:][::-1],
        "tools": sorted(({"name": k, "count": v} for k, v in tools.items()), key=lambda t: -t["count"])[:5],
        "files": {"written": len(written), "read": len([p for p in read if p not in written])},
        "kinds": order[:5],
        "diff": {"add": add, "del": rem},
        "activeMin": int(active // 60),
    }


async def glance(ids: str) -> dict:
    """What a Zed Mode card shows, for up to 40 conversations in one call.
    Session facts come straight from the session row (one query for all ids). Transcript-derived
    facts come from the cache unless that conversation changed since they were computed."""
    import json

    wanted = [i for i in (ids or "").split(",") if i][:40]
    if not wanted:
        return {"glance": {}, "cached": []}
    out: dict[str, dict] = {}
    hits: list[str] = []
    con = _ro()
    cache = _cache_db()
    try:
        marks = ",".join("?" * len(wanted))
        rows = {r["id"]: r for r in con.execute(f"SELECT {_SESSION_COLS} FROM sessions WHERE id IN ({marks})", wanted)}
        tips = dict(con.execute(f"SELECT session_id, MAX(id) FROM messages WHERE session_id IN ({marks}) GROUP BY session_id", wanted).fetchall())
        stored = {}
        if cache is not None:
            stored = {r[0]: (r[1], r[2]) for r in cache.execute(f"SELECT id, rev, data FROM glance WHERE id IN ({marks})", wanted)}
        fresh = []
        for sid in wanted:
            r = rows.get(sid)
            if r is None:
                continue
            # changes whenever a message is added, removed or rewritten
            rev = f"{_GLANCE_SCHEMA}:{r['message_count']}:{r['transcript_revision']}:{tips.get(sid, 0)}"
            derived = None
            if sid in _mem_cache and _mem_cache[sid][0] == rev:
                derived = _mem_cache[sid][1]
            elif sid in stored and stored[sid][0] == rev:
                derived = json.loads(stored[sid][1])
            if derived is not None:
                hits.append(sid)
            else:
                derived = _derive(con, sid)
                fresh.append((sid, rev, json.dumps(derived), time.time()))
            _mem_cache[sid] = (rev, derived)
            out[sid] = {
                **derived,
                "repo": Path(r["git_repo_root"]).name if r["git_repo_root"] else "",
                "branch": r["git_branch"] or "",
                "cwd": r["cwd"] or "",
                "model": r["model"] or "",
                "source": r["source"] or "",
                "messages": r["message_count"] or 0,
                "toolCalls": r["tool_call_count"] or 0,
                "tokens": (r["input_tokens"] or 0) + (r["output_tokens"] or 0),
                "cost": round(r["estimated_cost_usd"] or 0, 2),
                "activity": r["last_activity_description"] or "",
            }
        if cache is not None and fresh:
            try:
                cache.executemany("INSERT OR REPLACE INTO glance (id, rev, data, at) VALUES (?, ?, ?, ?)", fresh)
                cache.commit()
            except Exception:
                pass
    finally:
        con.close()
        if cache is not None:
            cache.close()
    return {"glance": out, "cached": hits}


async def folder(path: str, limit: int = 30) -> dict:
    """Every conversation whose root (git root, else cwd) is exactly `path`, newest first."""
    limit = max(1, min(100, int(limit)))
    deny = _internal_sources()
    rows = [r for r in _rows() if r["source"].lower() not in deny and (r["git_repo_root"] or r["cwd"]) == path]
    return {"path": path, "name": Path(path).name or path, "sessions": [_card(r) for r in rows[:limit]]}


def _route(fn):
    """Pass a route only the query params it declares. The desktop app adds its own to every
    plugin REST call (e.g. `?profile=default`, since 2026-11-10); passing those through as
    keyword arguments made every route a 400. Missing required params still 400."""
    import inspect

    accepted = set(inspect.signature(fn).parameters)

    async def call(**query):
        return await fn(**{k: v for k, v in query.items() if k in accepted})

    call.__name__ = fn.__name__
    return call


# Routes the dispatcher in plugin_api.py exposes: GET /api/plugins/zedmode/<name>
route_health, route_zed, route_session, route_folder, route_prompts, route_glance = map(
    _route, (health, zed, session, folder, prompts, glance)
)


async def resolve(model: str, provider: str = "", current_model: str = "", current_provider: str = "") -> dict:
    """Run Hermes' own model resolver for a pick and say WHY it fails. The owner's model mutation
    answers only `model_resolution_failed`; this is the same `switch_model` call it makes, against
    the same profile config, so Zed Mode can show the real reason (no credentials, server down, …)."""
    import asyncio

    # The one private seam this plugin leans on (disclosed in the README): the resolver is the only
    # place Hermes says WHY a model cannot be used. If it moves or changes shape, the answer is
    # "unknown" (`error`), never "not usable", and Zed Mode falls back to the gateway's own short reason.
    try:
        from hermes_cli.config import get_compatible_custom_providers, load_config
        from hermes_cli.model_switch import switch_model

        cfg = load_config()
    except Exception as exc:
        return {"ok": False, "error": True, "model": model, "provider": provider, "reason": f"{type(exc).__name__}: {exc}"}
    try:
        r = await asyncio.to_thread(
            switch_model, raw_input=model, current_provider=current_provider or "", current_model=current_model or "",
            explicit_provider=provider or "", is_global=False, user_providers=cfg.get("providers"),
            custom_providers=get_compatible_custom_providers(cfg))
    except Exception as exc:  # the resolver itself blew up: report it, don't 500
        return {"ok": False, "error": True, "model": model, "provider": provider, "reason": f"{type(exc).__name__}: {exc}"}
    return {"ok": bool(r.success), "model": getattr(r, "new_model", "") or model,
            "provider": getattr(r, "target_provider", "") or provider,
            "reason": "" if r.success else (getattr(r, "error_message", "") or "Hermes could not resolve this model.")}


_usable_cache: dict[str, tuple[float, dict]] = {}


async def usable(pairs: str, current_model: str = "", current_provider: str = "") -> dict:
    """Which of these providers can actually be switched to right now? `pairs` is a JSON list of
    [provider slug, one of its model ids]. Each is run through Hermes' own resolver (see `resolve`);
    a verdict is remembered for a minute. Used to keep providers whose login is missing out of
    the Zed Model menu, even when the catalog lists them as connected."""
    import json

    try:
        want = [(str(x[0]), str(x[1])) for x in json.loads(pairs or "[]") if isinstance(x, list) and len(x) == 2][:24]
    except Exception:
        want = []
    out: dict[str, dict] = {}
    now = time.time()
    for slug, model in want:
        hit = _usable_cache.get(slug)
        if hit and now - hit[0] < 60:
            out[slug] = hit[1]
            continue
        r = await resolve(model, slug, current_model, current_provider)
        if r.get("error"):  # the check itself failed: no verdict, so the menu keeps this provider
            continue
        out[slug] = {"ok": bool(r["ok"]), "reason": r["reason"]}
        _usable_cache[slug] = (now, out[slug])
    return {"providers": out}


route_resolve, route_usable = _route(resolve), _route(usable)
