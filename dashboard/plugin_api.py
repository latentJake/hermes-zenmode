"""Zed Mode backend, mounted by the gateway at /api/plugins/zedmode/.

This file is deliberately tiny and stable. The gateway imports it ONCE (on the first request
after `zedmode` is in `plugins.enabled`) and keeps that router until it restarts. So all
the logic lives in `zed_backend.py`, which this dispatcher re-imports whenever the file
changes: edit the backend, save, and the next request runs the new code. No restart.

Route: GET /<name>?<query>  →  zed_backend.route_<name>(**query)
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

_IMPL = Path(__file__).resolve().with_name("zed_backend.py")
_cache: dict = {"mod": None, "mtime": None}


def _impl():
    mtime = _IMPL.stat().st_mtime
    if _cache["mod"] is None or mtime != _cache["mtime"]:
        spec = importlib.util.spec_from_file_location("zedmode_backend", _IMPL)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _cache.update(mod=mod, mtime=mtime)
    return _cache["mod"]


@router.get("/{name}")
async def dispatch(name: str, request: Request):
    try:
        mod = _impl()
    except Exception:
        if _cache["mod"] is None:
            raise
        mod = _cache["mod"]  # a broken edit keeps serving the last good version
    fn = getattr(mod, "route_" + name.replace("-", "_"), None)
    if fn is None:
        raise HTTPException(status_code=404, detail=f"no route {name!r}")
    try:
        return await fn(**dict(request.query_params))
    except TypeError as exc:  # missing / unexpected query params
        raise HTTPException(status_code=400, detail=str(exc)) from exc
