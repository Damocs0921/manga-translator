import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# Gemini
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
DETECT_MODEL: str = os.environ.get("DETECT_MODEL", "gemini-3.8-flash")
TRANSLATE_MODEL: str = os.environ.get("TRANSLATE_MODEL", "gemini-3.8-flash")
# When the primary model hits its daily free quota, try these in order
FALLBACK_MODELS: list[str] = [
    m.strip() for m in os.environ.get(
        "FALLBACK_MODELS",
        "gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite",
    ).split(",") if m.strip()
]

# PDF rasterization
PDF_DPI: int = int(os.environ.get("PDF_DPI", "200"))

# Workspace for all project data
DATA_DIR: Path = Path(__file__).resolve().parent.parent / "data"

# Text rendering fonts (first existing one wins)
FONT_CANDIDATES: list[str] = [
    os.environ.get("FONT_PATH", ""),
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]
