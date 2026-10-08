"""Render translated text back into speech bubbles on the page image."""
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from . import config

_font_cache: dict[int, ImageFont.FreeTypeFont] = {}


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    if size not in _font_cache:
        path = next((p for p in config.FONT_CANDIDATES if p and Path(p).exists()), None)
        if path:
            _font_cache[size] = ImageFont.truetype(path, size)
        else:
            _font_cache[size] = ImageFont.load_default()
    return _font_cache[size]


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        cur = ""
        for ch in para:
            trial = cur + ch
            if draw.textlength(trial, font=font) <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = ch
        lines.append(cur)
    return lines


def _fit_text(draw: ImageDraw.ImageDraw, text: str, box_w: int, box_h: int, pad: int) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """Binary-search the largest font size whose wrapped text fits the box."""
    max_w, max_h = box_w - 2 * pad, box_h - 2 * pad
    lo, hi, best = 8, 64, None
    while lo <= hi:
        mid = (lo + hi) // 2
        font = _load_font(mid)
        lines = _wrap(draw, text, font, max_w)
        line_h = int(mid * 1.35)
        if len(lines) * line_h <= max_h:
            best = (font, lines, line_h)
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None:
        font = _load_font(8)
        lines = _wrap(draw, text, font, max_w)
        best = (font, lines, int(8 * 1.35))
    return best[0], best[1], best[2]


def render_page(page_path: Path, out_path: Path, bubbles: list[dict[str, Any]]) -> None:
    img = Image.open(page_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    for b in bubbles:
        if not b.get("translated_text"):
            continue
        x, y, w, h = b["box"]
        pad_box = 3
        # unified white background under translated text
        draw.rectangle(
            [x + pad_box, y + pad_box, min(img.width, x + w - pad_box), min(img.height, y + h - pad_box)],
            fill=(255, 255, 255),
        )
        text_pad = max(4, min(w, h) // 12)
        fs = b.get("font_size")
        if fs:
            # user-specified fixed font size: wrap to box width at that size
            font = _load_font(int(fs))
            lines = _wrap(draw, b["translated_text"], font, w - 2 * text_pad)
            line_h = int(fs * 1.35)
        else:
            font, lines, line_h = _fit_text(draw, b["translated_text"], w, h, text_pad)
        total_h = len(lines) * line_h
        ty = y + (h - total_h) // 2
        for line in lines:
            lw = draw.textlength(line, font=font)
            tx = x + (w - lw) / 2
            draw.text((tx, ty), line, font=font, fill=(20, 20, 20))
            ty += line_h
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
