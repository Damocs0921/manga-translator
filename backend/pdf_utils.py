"""PDF splitting: render each page to PNG via PyMuPDF."""
from pathlib import Path

import pymupdf  # PyMuPDF

from . import config


def split_pdf(pdf_path: Path, out_dir: Path, dpi: int | None = None) -> list[dict]:
    """Render every page to PNG. Returns [{file, width, height}, ...]."""
    dpi = dpi or config.PDF_DPI
    pdf_path, out_dir = Path(pdf_path), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    zoom = dpi / 72.0
    matrix = pymupdf.Matrix(zoom, zoom)
    infos = []
    with pymupdf.open(pdf_path) as doc:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            name = f"page_{i + 1:03d}.png"
            pix.save(out_dir / name)
            infos.append({"file": name, "width": pix.width, "height": pix.height})
    return infos
