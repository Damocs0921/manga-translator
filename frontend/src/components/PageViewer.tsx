import { useRef, useState } from 'react';
import type { Bubble, Page, Project } from '../types';
import { detectPage, pageImageUrl, pageOutputUrl, renderPage, translatePage } from '../api';

interface Props {
  project: Project;
  page: Page;
  onBubbleClick: (b: Bubble) => void;
  selectedBubbleId: string | null;
  viewMode: 'source' | 'output';
  onProjectUpdate: (p: Project) => void;
  onRendered: () => void;
  onTranslated: (page: Page) => void;
  onBubbleGeometry: (bid: string, box: [number, number, number, number]) => void;
  locked: boolean;
  lockHint?: string;
}

type Box = [number, number, number, number];

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startPt: { x: number; y: number };
  origBox: Box;
  box: Box;
  moved: boolean;
}

const HANDLE = 26; // resize-handle size in image pixels

export default function PageViewer({ project, page, onBubbleClick, selectedBubbleId, viewMode, onProjectUpdate, onRendered, onTranslated, onBubbleGeometry, locked, lockHint }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputStamp, setOutputStamp] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function applyPage(updated: Page) {
    onProjectUpdate({ ...project, pages: project.pages.map(p => (p.id === updated.id ? updated : p)) });
  }

  const imgSrc = viewMode === 'source'
    ? pageImageUrl(project.id, page.id)
    : `${pageOutputUrl(project.id, page.id)}?t=${outputStamp}`;

  // ---- bubble drag / resize ----
  function ptFromEvent(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * page.width,
      y: ((e.clientY - r.top) / r.height) * page.height,
    };
  }

  function startDrag(e: React.PointerEvent, b: Bubble, mode: 'move' | 'resize') {
    if (locked) return;
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch { /* synthetic/test events have no active pointer; fine */ }
    const p = ptFromEvent(e);
    setDrag({ id: b.id, mode, startPt: p, origBox: [...b.box] as Box, box: [...b.box] as Box, moved: false });
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag) return;
    const p = ptFromEvent(e);
    const dx = p.x - drag.startPt.x;
    const dy = p.y - drag.startPt.y;
    let [x, y, w, h] = drag.origBox;
    if (drag.mode === 'move') {
      x += dx;
      y += dy;
    } else {
      w = Math.max(20, w + dx);
      h = Math.max(20, h + dy);
    }
    setDrag({
      ...drag,
      box: [Math.round(x), Math.round(y), Math.round(w), Math.round(h)],
      moved: drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2,
    });
  }

  function endDrag() {
    if (!drag) return;
    if (drag.moved) onBubbleGeometry(drag.id, drag.box);
    setDrag(null);
  }

  const boxOf = (b: Bubble): Box =>
    drag?.id === b.id ? drag.box : b.box;

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <span className={`badge st-${page.status}`}>{page.status}</span>
        <span className="bubble-count">{page.bubbles.length} 个气泡</span>
        {locked
          ? <span className="lock-hint">🔒 {lockHint ?? '批量处理中，页面操作已锁定'}</span>
          : viewMode === 'output'
            ? <span className="hint">预览模式：切回「原图」可检测/翻译/编辑</span>
            : <>
                <button disabled={!!busy} onClick={() => run('detect', async () => applyPage(await detectPage(project.id, page.id)))}>
                  {busy === 'detect' ? '检测中…' : '检测气泡'}
                </button>
                <button disabled={!!busy || !page.bubbles.length} onClick={() => run('translate', async () => {
                  const updated = await translatePage(project.id, page.id);
                  applyPage(updated);
                  onTranslated(updated);
                })}>
                  {busy === 'translate' ? '翻译中…' : 'AI 翻译'}
                </button>
                <button
                  disabled={!!busy || !page.bubbles.length}
                  onClick={() => run('render', async () => {
                    applyPage((await renderPage(project.id, page.id)).page);
                    setOutputStamp(Date.now());
                    onRendered();
                  })}
                >
                  {busy === 'render' ? '渲染中…' : '渲染译文图'}
                </button>
              </>
        }
      </div>
      {error && <div className="error">{error}</div>}
      <div className="viewer-canvas">
        <div className="img-wrap">
          <img src={imgSrc} alt={page.id} />
          {viewMode === 'source' && (
            <svg
              ref={svgRef}
              className="overlay"
              viewBox={`0 0 ${page.width} ${page.height}`}
              preserveAspectRatio="none"
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {page.bubbles.map(b => {
                const [x, y, w, h] = boxOf(b);
                const selected = b.id === selectedBubbleId;
                return (
                  <g key={b.id}>
                    <rect
                      x={x} y={y} width={w} height={h}
                      className={`bubble-rect ${selected ? 'selected' : ''} ${b.translated_text ? 'done' : ''} ${locked ? '' : 'draggable'}`}
                      onPointerDown={e => startDrag(e, b, 'move')}
                      onClick={() => { if (!drag?.moved) onBubbleClick(b); }}
                    />
                    {selected && !locked && (
                      <rect
                        x={x + w - HANDLE / 2} y={y + h - HANDLE / 2}
                        width={HANDLE} height={HANDLE}
                        className="resize-handle"
                        onPointerDown={e => startDrag(e, b, 'resize')}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
