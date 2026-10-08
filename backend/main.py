"""Manga Translator backend: FastAPI app with all routes."""
import asyncio
import shutil
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import config, gemini_client, pdf_utils, renderer, storage

app = FastAPI(title="Manga Translator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local dev tool
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RuntimeError)
async def runtime_error_handler(request: Request, exc: RuntimeError):
    """Surface Gemini/backend runtime errors to the frontend as readable JSON."""
    return JSONResponse(status_code=503, content={"detail": str(exc)})

# In-memory batch progress: project_id -> {running, total, done, current, errors}
batch_status: dict[str, dict[str, Any]] = {}


def _require_project(pid: str) -> dict[str, Any]:
    proj = storage.load_project(pid)
    if not proj:
        raise HTTPException(404, f"project {pid} not found")
    return proj


def _require_page(proj: dict, page_id: str) -> dict[str, Any]:
    page = storage.find_page(proj, page_id)
    if not page:
        raise HTTPException(404, f"page {page_id} not found")
    return page


def _page_path(pid: str, rel: str) -> Path:
    return config.DATA_DIR / pid / rel


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "只支持 PDF 文件")
    pid = storage.new_project_id()
    pdir = storage._project_dir(pid)
    pdf_path = pdir / "source.pdf"
    with open(pdf_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    try:
        infos = await asyncio.to_thread(pdf_utils.split_pdf, pdf_path, pdir / "pages")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"PDF 解析失败: {e}") from e
    pages = [storage.new_page_entry(i, info["file"], info["width"], info["height"])
             for i, info in enumerate(infos)]
    project = {"id": pid, "name": file.filename, "target_lang": "zh", "vertical": False, "pages": pages}
    storage.save_project(project)
    return project


@app.get("/api/projects")
async def projects():
    return storage.list_projects()


@app.get("/api/projects/{pid}")
async def project_detail(pid: str):
    return _require_project(pid)


@app.put("/api/projects/{pid}/target_lang")
async def set_target_lang(pid: str, lang: str):
    if lang not in ("zh", "en"):
        raise HTTPException(400, "lang 必须是 zh 或 en")
    proj = _require_project(pid)
    proj["target_lang"] = lang
    storage.save_project(proj)
    return proj


@app.put("/api/projects/{pid}/vertical")
async def set_vertical(pid: str, vertical: bool):
    proj = _require_project(pid)
    proj["vertical"] = bool(vertical)
    storage.save_project(proj)
    return proj


@app.get("/api/projects/{pid}/pages/{page_id}/image")
async def page_image(pid: str, page_id: str):
    proj = _require_project(pid)
    page = _require_page(proj, page_id)
    return FileResponse(_page_path(pid, page["file"]), media_type="image/png")


@app.get("/api/projects/{pid}/pages/{page_id}/output")
async def page_output(pid: str, page_id: str):
    proj = _require_project(pid)
    page = _require_page(proj, page_id)
    out = _page_path(pid, f"output/{page_id}.png")
    if not out.exists():
        raise HTTPException(404, "尚未渲染，请先执行渲染")
    return FileResponse(out, media_type="image/png")


@app.post("/api/projects/{pid}/pages/{page_id}/detect")
async def detect_page(pid: str, page_id: str):
    proj = _require_project(pid)
    page = _require_page(proj, page_id)
    img_bytes = _page_path(pid, page["file"]).read_bytes()
    bubbles = await asyncio.to_thread(
        gemini_client.detect_bubbles, img_bytes, page["width"], page["height"]
    )
    page["bubbles"] = bubbles
    page["status"] = "detected" if bubbles else "pending"
    storage.save_project(proj)
    return page


@app.post("/api/projects/{pid}/pages/{page_id}/translate")
async def translate_page(pid: str, page_id: str):
    proj = _require_project(pid)
    page = _require_page(proj, page_id)
    if not page["bubbles"]:
        raise HTTPException(400, "请先检测气泡")
    texts = [b["source_text"] for b in page["bubbles"]]
    translations = await asyncio.to_thread(
        gemini_client.translate_texts, texts, proj["target_lang"]
    )
    for b, t in zip(page["bubbles"], translations):
        if not b["edited"]:
            b["translated_text"] = t
    if page["status"] in ("detected", "pending"):
        page["status"] = "translated"
    storage.save_project(proj)
    return page


@app.put("/api/projects/{pid}/pages/{page_id}/bubbles/{bid}")
async def edit_bubble(pid: str, page_id: str, bid: str, body: dict):
    proj = _require_project(pid)
    page = _require_page(proj, page_id)
    bubble = next((b for b in page["bubbles"] if b["id"] == bid), None)
    if not bubble:
        raise HTTPException(404, f"bubble {bid} not found")
    if not any(k in body for k in ("translated_text", "box", "font_size")):
        raise HTTPException(400, "缺少 translated_text / box / font_size 之一")
    if "box" in body:
        box = body["box"]
        if not isinstance(box, list) or len(box) != 4 or not all(isinstance(v, (int, float)) for v in box):
            raise HTTPException(400, "box 必须是 [x, y, w, h] 四个数字")
        if box[2] < 10 or box[3] < 10:
            raise HTTPException(400, "气泡宽高不能小于 10px")
        bubble["box"] = [int(round(v)) for v in box]
    if "font_size" in body:
        fs = body["font_size"]
        if fs is not None and (not isinstance(fs, (int, float)) or not 6 <= fs <= 200):
            raise HTTPException(400, "font_size 须为 6-200 的数字或 null（自动）")
        bubble["font_size"] = int(fs) if fs is not None else None
    if "translated_text" in body:
        bubble["translated_text"] = body["translated_text"]
        bubble["edited"] = True
    storage.save_project(proj)
    return bubble


@app.delete("/api/projects/{pid}/pages/{page_id}/bubbles/{bid}")
async def delete_bubble(pid: str, page_id: str, bid: str):
    proj = _require_project(pid)
    page = _require_page(proj, page_id)
    before = len(page["bubbles"])
    page["bubbles"] = [b for b in page["bubbles"] if b["id"] != bid]
    if len(page["bubbles"]) == before:
        raise HTTPException(404, f"bubble {bid} not found")
    storage.save_project(proj)
    return page


@app.post("/api/projects/{pid}/pages/{page_id}/render")
async def render_page_route(pid: str, page_id: str):
    proj = _require_project(pid)
    page = _require_page(proj, page_id)
    src = _page_path(pid, page["file"])
    out = _page_path(pid, f"output/{page_id}.png")
    await asyncio.to_thread(renderer.render_page, src, out, page["bubbles"], proj.get("vertical", False))
    page["status"] = "rendered"
    storage.save_project(proj)
    return {"ok": True, "page": page}


@app.post("/api/projects/{pid}/batch")
async def start_batch(pid: str, body: dict):
    """Auto-process selected pages: detect -> translate -> render."""
    proj = _require_project(pid)
    page_ids = body.get("page_ids") or [p["id"] for p in proj["pages"]]
    status = {"running": True, "total": len(page_ids), "done": 0, "current": "", "errors": [], "page_ids": page_ids}
    batch_status[pid] = status

    async def run():
        p = _require_project(pid)
        for pg_id in page_ids:
            status["current"] = pg_id
            try:
                page = _require_page(p, pg_id)
                img_bytes = _page_path(pid, page["file"]).read_bytes()
                page["bubbles"] = await asyncio.to_thread(
                    gemini_client.detect_bubbles, img_bytes, page["width"], page["height"]
                )
                if page["bubbles"]:
                    texts = [b["source_text"] for b in page["bubbles"]]
                    translations = await asyncio.to_thread(
                        gemini_client.translate_texts, texts, p["target_lang"]
                    )
                    for b, t in zip(page["bubbles"], translations):
                        if not b["edited"]:
                            b["translated_text"] = t
                    page["status"] = "translated"
                    await asyncio.to_thread(
                        renderer.render_page,
                        _page_path(pid, page["file"]),
                        _page_path(pid, f"output/{pg_id}.png"),
                        page["bubbles"],
                        p.get("vertical", False),
                    )
                    page["status"] = "rendered"
                else:
                    # no bubbles: just copy the original page as output
                    out = _page_path(pid, f"output/{pg_id}.png")
                    out.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(_page_path(pid, page["file"]), out)
                    page["status"] = "rendered"
                storage.save_project(p)
            except Exception as e:  # noqa: BLE001
                status["errors"].append({"page": pg_id, "error": str(e)})
            status["done"] += 1
        status["running"] = False
        status["current"] = ""

    asyncio.create_task(run())
    return {"ok": True, "total": len(page_ids)}


@app.get("/api/projects/{pid}/batch/status")
async def batch_status_route(pid: str):
    return batch_status.get(pid, {"running": False, "total": 0, "done": 0, "current": "", "errors": [], "page_ids": []})


@app.get("/api/projects/{pid}/export")
async def export_all(pid: str):
    """Zip all rendered output pages for download."""
    import zipfile

    proj = _require_project(pid)
    outdir = _page_path(pid, "output")
    if not outdir.exists() or not any(outdir.glob("*.png")):
        raise HTTPException(400, "没有已渲染的页面")
    zip_path = _page_path(pid, "export.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for png in sorted(outdir.glob("*.png")):
            zf.write(png, png.name)
    stem = Path(proj["name"]).stem or pid
    return FileResponse(zip_path, filename=f"{stem}-译文图.zip", media_type="application/zip")


@app.get("/api/projects/{pid}/export_pdf")
async def export_pdf(pid: str):
    """Merge all rendered output pages into a single PDF for download."""
    from PIL import Image

    proj = _require_project(pid)
    outdir = _page_path(pid, "output")
    pngs = sorted(outdir.glob("*.png")) if outdir.exists() else []
    if not pngs:
        raise HTTPException(400, "没有已渲染的页面")
    pdf_path = _page_path(pid, "export.pdf")

    def build_pdf():
        images = [Image.open(p).convert("RGB") for p in pngs]
        images[0].save(pdf_path, "PDF", save_all=True, append_images=images[1:])
        for im in images:
            im.close()

    await asyncio.to_thread(build_pdf)
    # download filename follows the original PDF name (e.g. ch1.pdf -> ch1-译文.pdf)
    stem = Path(proj["name"]).stem or pid
    return FileResponse(pdf_path, filename=f"{stem}-译文.pdf", media_type="application/pdf")
