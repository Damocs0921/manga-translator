# 漫画翻译器（Manga Translator）

本地 Web 应用：导入日文漫画 PDF → 自动拆页 → AI 检测气泡并 OCR 日文 → AI 翻译 → 界面编辑译文 → 嵌回原图 → 导出 PNG / ZIP / 合并 PDF。支持批量自动处理 + 逐页手动调整。

## 功能

- **PDF 导入**：自动按 200 DPI 拆分每一页为 PNG
- **气泡检测**：Gemini 视觉模型定位每个日文对话气泡坐标并转录原文
- **AI 翻译**：一键翻译整页气泡，目标语言可切换（日→中 / 日→英）
- **译文编辑**：点选气泡，右侧面板对照原文/译文，编辑后重新渲染嵌回原坐标
- **批量处理**：勾选页面自动执行「检测 → 翻译 → 渲染」，实时进度，完成后逐页微调
- **导出**：单页 PNG 预览下载、全部译文图 ZIP、合并为单个 PDF

## 环境要求

- Python 3.10+
- Node.js 18+
- [Gemini API Key](https://aistudio.google.com/apikey)（免费额度即可，注意免费层每模型每日请求有上限）

## 快速启动

### 1. 配置 API Key

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入你的 GEMINI_API_KEY
```

### 2. 启动后端

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --port 8000
```

### 3. 启动前端（另开一个终端）

```bash
cd frontend
npm install
npm run dev
```

### 4. 打开浏览器

访问 http://localhost:5173 ，导入 PDF 即可开始。

## 使用流程

1. 点击顶部「导入 PDF」，等待页面拆分完成
2. 左侧缩略图选择页面，点击「检测气泡」（黄框 = 未翻译，绿框 = 已有译文）
3. 点击「AI 翻译」生成整页译文
4. 点选任意气泡，在右侧面板查看原文/译文并编辑，点「保存并重新渲染」
5. 顶部可切换「原图 / 译文图」预览
6. 批量：右侧面板勾选页面 →「开始批量处理」，完成后逐页检查微调
7. 导出：右侧「导出全部译文图（ZIP）」或「合并导出 PDF」

## 配置说明（backend/.env）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `GEMINI_API_KEY` | 无（必填） | Google AI Studio 申请的 Key |
| `DETECT_MODEL` | `gemini-3.8-flash` | 气泡检测/OCR 模型 |
| `TRANSLATE_MODEL` | `gemini-3.8-flash` | 翻译模型 |
| `FALLBACK_MODELS` | 见 `.env.example` | 主模型配额用尽时按此顺序自动切换 |
| `PDF_DPI` | `200` | PDF 拆页分辨率 |
| `FONT_PATH` | 系统字体 | 译文渲染字体（默认自动选 PingFang SC） |

> 提示：Gemini 免费额度**按模型独立计算**（如每模型每天 20 次请求）。模型配额用尽时系统会按 `FALLBACK_MODELS` 列表自动切换到还有额度的模型，全部耗尽才会报错（次日重置）。

## 项目结构

```
├── backend/
│   ├── main.py           # FastAPI 路由（上传/检测/翻译/渲染/批量/导出）
│   ├── gemini_client.py  # Gemini 检测 + OCR + 翻译
│   ├── renderer.py       # 气泡填充 + 译文排版渲染
│   ├── pdf_utils.py      # PDF 拆页（PyMuPDF）
│   ├── storage.py        # 项目数据持久化（data/<项目>/project.json）
│   └── config.py         # 环境变量配置
├── frontend/
│   └── src/
│       ├── App.tsx               # 三栏布局主界面
│       └── components/
│           ├── PageSidebar.tsx   # 页面缩略图列表
│           ├── PageViewer.tsx    # 大图 + SVG 气泡框点选
│           ├── BubblePanel.tsx   # 原文/译文编辑面板
│           └── BatchPanel.tsx    # 批量处理 + 导出
└── data/                 # 运行时项目数据（已 gitignore）
```

## 常见问题

**点击检测/翻译报「Gemini 免费额度已用完」**
免费层每模型每日请求有上限（如 20 次/天），换一个 `.env` 中的模型或等待次日重置。

**报「Gemini 服务暂不可用」**
模型负载过高（503），系统会自动重试数次，仍失败可稍后再试或换模型。

**译文没有完全覆盖原文 / 字太小**
气泡框是 AI 检测的近似范围，可在 project.json 或后续版本中调整；字号会自动适配气泡大小，过长译文建议在编辑面板精简。
