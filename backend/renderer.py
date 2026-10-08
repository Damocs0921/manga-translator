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


def _bg_color(img: Image.Image, box: list[int]) -> tuple:
    """Sample border pixels of the bubble region to pick the fill color."""
    x, y, w, h = box
    px = img.load()
    samples = []
    coords = (
        [(xx, y + 1) for xx in range(max(0, x), min(img.width, x + w), max(1, w // 8))]
        + [(xx, min(img.height - 1, y + h - 1)) for xx in range(max(0, x), min(img.width, x + w), max(1, w // 8))]
        + [(x + 1, yy) for yy in range(max(0, y), min(img.height, y + h), max(1, h // 8))]
        + [(min(img.width - 1, x + w - 1), yy) for yy in range(max(0, y), min(img.height, y + h), max(1, h // 8))]
    )
    for c in coords:
        if 0 <= c[0] < img.width and 0 <= c[1] < img.height:
            samples.append(px[c[0], c[1]])
    if not samples:
        return (255, 255, 255)
    r = sum(s[0] for s in samples) // len(samples)
    g = sum(s[1] for s in samples) // len(samples)
    b = sum(s[2] for s in samples) // len(samples)
    return (r, g, b)


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
        fill = _bg_color(img, b["box"])
        draw.rectangle(
            [x + pad_box, y + pad_box, min(img.width, x + w - pad_box), min(img.height, y + h - pad_box)],
            fill=fill,
        )
        text_pad = max(4, min(w, h) // 12)
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
