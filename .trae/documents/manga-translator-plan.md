# 漫画翻译软件（Manga Translator）实施计划

## Context

从零构建一个本地 Web 应用：导入日文漫画 PDF → 拆分页面 → AI 检测气泡并定位 → 提取日文原文 → AI 翻译 → 界面编辑译文 → 译文嵌回原图导出。支持批量自动处理 + 手动逐页调整。

已确认的决策：
- **AI 服务**：Google Gemini（需用户提供 `GEMINI_API_KEY`）
- **形态**：本地 Web 应用（FastAPI 后端 + React 前端，浏览器操作）
- **目标语言**：可切换（中文/英文）

技术调研结论（2026-10 现状）：
- Gemini 稳定模型：检测用 `gemini-3.8-flash`（可配置为 `gemini-3.5-flash-lite` 降成本）；2.5 系列已限制新用户访问，不可用
- 气泡定位：`google-genai` SDK 的 `response_schema`（Pydantic）结构化输出，`box_2d = [ymin, xmin, ymax, xmax]` 归一化 0-1000，换算像素 = 值/1000 × 原图尺寸
- PDF 拆分：`PyMuPDF`（纯 Python 无外部依赖，按 DPI 渲染页面为 PNG）

## 架构

```
manga-translator/
├── backend/
│   ├── requirements.txt        # fastapi uvicorn pymupdf google-genai pillow python-multipart python-dotenv
│   ├── main.py                 # FastAPI 入口 + 所有路由
│   ├── config.py               # 环境变量: GEMINI_API_KEY, DETECT_MODEL(默认gemini-3.8-flash), TRANSLATE_MODEL, DPI(默认200)
│   ├── pdf_utils.py            # PDF → 页面 PNG
│   ├── gemini_client.py        # Gemini 检测(视觉+OCR) / 翻译(纯文本)
│   ├── renderer.py             # 气泡背景填充 + 译文排版绘制
│   └── storage.py              # workspace 数据读写(JSON 文件)
├── frontend/                   # Vite + React + TypeScript
│   └── src/
│       ├── App.tsx             # 整体布局 + 状态管理
│       ├── api.ts              # fetch 封装
│       └── components/
│           ├── UploadBar.tsx       # 上传 PDF / 目标语言切换 / 导出
│           ├── PageSidebar.tsx     # 页面缩略图 + 状态徽标(未处理/已检测/已翻译/已导出)
│           ├── PageViewer.tsx      # 页面大图 + SVG 气泡框覆盖层(可点选)
│           ├── BubblePanel.tsx     # 右侧原文/译文对照 + 译文编辑
│           └── BatchPanel.tsx      # 批量自动处理 + 进度
└── data/                       # 运行时工作区(gitignore)
    └── <project_id>/
        ├── source.pdf
        ├── pages/page_001.png ...      # 原始页
        ├── output/page_001.png ...     # 翻译嵌回后的页
        └── project.json                # 页面列表 + 气泡数据(坐标为像素、原文、译文、是否手动编辑、页面状态)
```

## 核心设计

### 1. 数据模型（storage.py，存于 project.json）

```json
{
  "id": "20261008-153000",
  "target_lang": "zh",
  "pages": [{
    "id": "page_001", "file": "pages/page_001.png",
    "width": 1654, "height": 2339,
    "status": "pending | detected | translated | rendered",
    "bubbles": [{
      "id": "b1",
      "box": [x, y, w, h],          // 像素坐标
      "source_text": "…",           // Gemini OCR 日文
      "translated_text": "…",       // AI 译文，可被手动编辑覆盖
      "edited": false
    }]
  }]
}
```

### 2. Gemini 调用（gemini_client.py）

**检测+OCR（一次视觉调用/页）**：
```python
class Bubble(BaseModel):
    box_2d: list[int]      # [ymin, xmin, ymax, xmax] 归一化 0-1000
    japanese_text: str

config = GenerateContentConfig(
    system_instruction="检测图中所有日文对话气泡…box 覆盖整个气泡而非仅文字…按阅读顺序输出",
    response_mime_type="application/json",
    response_schema=list[Bubble],
)
# client.models.generate_content(model=DETECT_MODEL, contents=[图片bytes, prompt], config=config)
# 响应解析 response.parsed，坐标换算像素
```

**翻译（纯文本调用/页，批量气泡一次翻译）**：
- 输入：整页气泡的日文列表 + 上下文说明（漫画对白、保留语气词、人名音译规则）+ target_lang
- response_schema 返回 `list[TranslatedItem]`（按序号对应），逐气泡回填

### 3. 译文嵌回（renderer.py，Pillow）

1. 载入原始页 PNG
2. 每个气泡：取 bbox 内边缘采样主色（通常为白）填充整个 bbox（可向内收缩 2-3px）
3. 译文排版：二分查找最大字号，使自动换行后的文本放入 bbox（留 padding），居中绘制黑色文字
4. 字体：优先 macOS 系统字体 PingFang SC（中文）/ Hiragino（日文回退），config 可覆盖路径
5. 输出到 `output/page_XXX.png`

### 4. API 路由（main.py）

| 方法 | 路径 | 功能 |
|---|---|---|
| POST | /api/upload | 上传 PDF，拆分页面，创建项目 |
| GET | /api/projects | 项目列表 |
| GET | /api/projects/{pid} | 项目详情（含全部气泡数据） |
| GET | /api/projects/{pid}/pages/{page_id}/image | 原图 PNG |
| GET | /api/projects/{pid}/pages/{page_id}/output | 译文图 PNG（下载/预览） |
| POST | /api/projects/{pid}/pages/{page_id}/detect | 气泡检测+OCR |
| POST | /api/projects/{pid}/pages/{page_id}/translate | 翻译本页全部气泡 |
| PUT | /api/projects/{pid}/pages/{page_id}/bubbles/{bid} | 保存手动编辑的译文 |
| POST | /api/projects/{pid}/pages/{page_id}/render | 重新渲染译文图 |
| POST | /api/projects/{pid}/batch | 批量后台任务（对所选页 自动: 检测→翻译→渲染） |
| GET | /api/projects/{pid}/batch/status | 轮询批量进度 |

批量任务用 `asyncio.create_task` + 内存进度字典；前端 2s 轮询。

### 5. 前端交互

- 布局：顶部工具栏（上传/语言切换/批量按钮）+ 左侧缩略图栏 + 中间大图区 + 右侧译文面板
- PageViewer：`<img>` 上叠 SVG `<rect>` 气泡框；点击 rect 选中 → 右侧面板显示该气泡原文/译文
- BubblePanel：译文 textarea 可编辑 →「保存」PUT 后端 →「重新渲染」预览更新 → 可下载
- 已渲染气泡显示绿色边框，未翻译黄色；支持"预览模式"切换显示 原图/译文图
- BatchPanel：选择页范围 + 目标语言 → 启动 → 进度条 → 完成后逐页人工复查微调
- Vite dev server 配置 proxy `/api` → `localhost:8000`

## 实施步骤

1. **后端基础**：requirements.txt、config.py、storage.py、pdf_utils.py、main.py（upload/projects/image 路由）
2. **Gemini 客户端**：gemini_client.py（detect + translate，含坐标换算、错误处理与重试）
3. **渲染导出**：renderer.py + render/output 路由
4. **批量任务**：batch 路由 + 进度状态
5. **前端脚手架**：Vite React TS 初始化、api.ts、整体布局三栏
6. **前端核心交互**：PageSidebar / PageViewer（SVG 气泡框点选）/ BubblePanel（编辑保存）/ 上传与语言切换
7. **前端批量与导出**：BatchPanel 进度轮询、译文图预览切换、下载
8. **端到端验证**（见下）

## 验证方案

1. **合成测试素材**：用 PIL 生成"伪漫画页"（白底 + 椭圆气泡 + 日文文字，用 macOS Hiragino 字体绘制），PyMuPDF 打包成测试 PDF
2. **后端冒烟**：`uvicorn backend.main:app` 启动后 curl 走通 upload → detect → translate → render 全链路，检查 project.json 数据与 output PNG 正确
3. **前端 E2E**：`npm run dev` 启动，用 Chrome DevTools MCP 打开页面，验证：上传 PDF → 缩略图出现 → 点击检测 → 气泡框显示 → 点选气泡 → 编辑译文 → 渲染 → 下载
4. **批量流程**：多页 PDF 跑批量，验证进度轮询与逐页微调

## 运行前提

- 用户提供 `GEMINI_API_KEY`（写入 backend/.env，gitignore）
- Python 3.10+，Node 18+
