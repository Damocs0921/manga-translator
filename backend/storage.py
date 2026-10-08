"""Project data persistence: each project lives in data/<project_id>/."""
import json
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from . import config

_lock = threading.Lock()


def _project_dir(project_id: str) -> Path:
    d = config.DATA_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _meta_path(project_id: str) -> Path:
    return _project_dir(project_id) / "project.json"


def save_project(project: dict[str, Any]) -> None:
    with _lock:
        with open(_meta_path(project["id"]), "w", encoding="utf-8") as f:
            json.dump(project, f, ensure_ascii=False, indent=1)


def load_project(project_id: str) -> dict[str, Any] | None:
    p = _meta_path(project_id)
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def list_projects() -> list[dict[str, Any]]:
    out = []
    if config.DATA_DIR.exists():
        for d in sorted(config.DATA_DIR.iterdir()):
            meta = d / "project.json"
            if meta.exists():
                with open(meta, encoding="utf-8") as f:
                    out.append(json.load(f))
    return out


def new_project_id() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]


def new_page_entry(idx: int, filename: str, width: int, height: int) -> dict[str, Any]:
    return {
        "id": f"page_{idx + 1:03d}",
        "file": f"pages/{filename}",
        "width": width,
        "height": height,
        "status": "pending",  # pending -> detected -> translated -> rendered
        "bubbles": [],
    }


def find_page(project: dict[str, Any], page_id: str) -> dict[str, Any] | None:
    for p in project["pages"]:
        if p["id"] == page_id:
            return p
    return None
