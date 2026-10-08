"""Gemini API calls: bubble detection + OCR (vision) and batch translation (text)."""
import io
import re
import time
from typing import Any

from google import genai
from google.genai import types
from PIL import Image
from pydantic import BaseModel, Field

from . import config

_client: genai.Client | None = None

# Long-edge pixel size for images sent to Gemini (detection is resolution-insensitive
# beyond this, but latency/payload shrink dramatically)
MAX_DIM = 1280


def get_client() -> genai.Client:
    global _client
    if _client is None:
        if not config.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY 未设置，请在 backend/.env 中配置")
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


def _clean_err(e: Exception) -> str:
    """Extract a short, readable message from a Gemini API error."""
    s = str(e)
    m = re.search(r"'message': '(.+?)'", s)
    msg = m.group(1).replace("\\n", " ") if m else s
    if "RESOURCE_EXHAUSTED" in s or "exceeded your current quota" in msg:
        retry = re.search(r"Please retry in ([\dhms.]+)", msg)
        hint = f"，需等待 {retry.group(1)} 后重试" if retry else ""
        return f"Gemini 免费额度已用完（每日限额），可更换模型或在 .env 中切换有额度的模型{hint}。原始信息: {msg[:200]}"
    if "503" in s or "UNAVAILABLE" in s:
        return f"Gemini 服务暂不可用（模型负载过高），请稍后重试或换用其他模型。原始信息: {msg[:200]}"
    return msg[:300]


def _is_quota_err(e: Exception) -> bool:
    return "RESOURCE_EXHAUSTED" in str(e) or "exceeded your current quota" in str(e)


# Sticky model memory: models known to be quota-exhausted (this process lifetime)
# and the last model that worked (tried first next time).
_exhausted: set[str] = set()
_last_good_model: str | None = None


def _model_candidates(primary: str) -> list[str]:
    """Primary model first (unless known exhausted), then fallbacks, deduped."""
    candidates: list[str] = []
    ordered = ([_last_good_model] if _last_good_model and _last_good_model != primary else [])
    ordered += [primary] + config.FALLBACK_MODELS
    for m in ordered:
        if m and m not in candidates and m not in _exhausted:
            candidates.append(m)
    return candidates or [primary]


def _generate(model: str, contents: list, schema: type, system_instruction: str, retries: int = 3):
    """generate_content with structured output.

    Tries the primary model first; on daily-quota (429) errors automatically
    falls through to FALLBACK_MODELS. Transient errors (503 etc.) are retried.
    """
    global _last_good_model
    last_err: Exception | None = None
    for m in _model_candidates(model):
        for attempt in range(retries + 1):
            try:
                resp = get_client().models.generate_content(
                    model=m,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=schema,
                    ),
                )
                _last_good_model = m
                return resp.parsed
            except Exception as e:  # noqa: BLE001 - network/API errors
                last_err = e
                if _is_quota_err(e):
                    _exhausted.add(m)  # move on to the next fallback model
                    break
                if attempt < retries:
                    time.sleep(3 * (attempt + 1))
    raise RuntimeError(_clean_err(last_err) if last_err else "Gemini 调用失败")


class _Bubble(BaseModel):
    box_2d: list[int] = Field(
        description="气泡边界框 [ymin, xmin, ymax, xmax]，坐标为 0-1000 归一化整数，框覆盖整个气泡"
    )
    japanese_text: str = Field(description="气泡内的日文原文，逐字转录，保留换行")


DETECT_SYSTEM = (
    "你是一名漫画助理。任务：检测图片中所有包含日文文字的对话气泡（speech bubble）并转录文字。"
    "规则：\n"
    "1. box_2d 必须覆盖整个气泡（含气泡尾巴），不是仅文字区域；\n"
    "2. 画外音/旁白/拟声词文字块也检测出来；\n"
    "3. japanese_text 逐字转录气泡内日文，竖排文字按正常阅读顺序转成横排；\n"
    "4. 按日漫阅读顺序（右上→左下）排列结果；\n"
    "5. 只输出真正的文字气泡，无文字的空气泡跳过；"
    "6. 不要遗漏任何含文字的气泡。"
)


def detect_bubbles(image_bytes: bytes, width: int, height: int) -> list[dict[str, Any]]:
    """Detect speech bubbles with OCR. Returns pixel-coordinate bubbles (original image scale)."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    scale = min(1.0, MAX_DIM / max(img.width, img.height))
    img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))))
    sw, sh = img.size
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    parsed = _generate(
        model=config.DETECT_MODEL,
        contents=[types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
                  "检测本漫画页中所有含日文文字的气泡，给出边界框和日文原文。"],
        schema=list[_Bubble],
        system_instruction=DETECT_SYSTEM,
    )
    bubbles: list[dict[str, Any]] = []
    for i, b in enumerate(parsed or []):
        if len(b.box_2d) != 4:
            continue
        ymin, xmin, ymax, xmax = [max(0, min(1000, v)) for v in b.box_2d]
        x = int(xmin / 1000 * sw / scale)
        y = int(ymin / 1000 * sh / scale)
        w = int((xmax - xmin) / 1000 * sw / scale)
        h = int((ymax - ymin) / 1000 * sh / scale)
        w = min(w, width - x)
        h = min(h, height - y)
        if w < 8 or h < 8:
            continue
        bubbles.append({
            "id": f"b{i + 1}",
            "box": [x, y, w, h],
            "source_text": b.japanese_text.strip(),
            "translated_text": "",
            "edited": False,
        })
    return bubbles


class _TranslatedItem(BaseModel):
    index: int = Field(description="对应输入的气泡序号，从 1 开始")
    translation: str = Field(description="该气泡的译文，仅译文本身")


def translate_texts(texts: list[str], target_lang: str) -> list[str]:
    """Translate a page's bubble texts in one call, preserving order."""
    if not texts:
        return []
    numbered = "\n".join(f"{i}. {t}" for i, t in enumerate(texts, 1))
    lang_name = {"zh": "简体中文", "en": "English"}.get(target_lang, target_lang)
    system = (
        f"你是专业的日漫汉化译者。把日文漫画对白翻译成{lang_name}。规则：\n"
        "1. 译文要符合漫画口语风格，简洁自然，符合气泡长度限制；"
        "2. 保留语气（怒吼/撒娇/低语等）；"
        "3. 拟声词译成对应的译语拟声词；"
        "4. 同一页中保持人称、称谓、角色语气一致；"
        "5. 输出条目的 index 与输入序号一一对应，一个不落。"
    )
    parsed = _generate(
        model=config.TRANSLATE_MODEL,
        contents=[f"翻译以下漫画气泡对白（每行一条，序号在行首）：\n{numbered}"],
        schema=list[_TranslatedItem],
        system_instruction=system,
    )
    result = list(texts)  # fallback: keep original if missing
    for item in parsed or []:
        if 1 <= item.index <= len(result):
            result[item.index - 1] = item.translation
    return result
