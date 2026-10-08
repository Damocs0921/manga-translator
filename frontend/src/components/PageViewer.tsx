import { useState } from 'react';
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
  locked: boolean;
  lockHint?: string;
}

export default function PageViewer({ project, page, onBubbleClick, selectedBubbleId, viewMode, onProjectUpdate, onRendered, onTranslated, locked, lockHint }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputStamp, setOutputStamp] = useState(0);

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

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <span className={`badge st-${page.status}`}>{page.status}</span>
        <span className="bubble-count">{page.bubbles.length} 个气泡</span>
        {locked
          ? <span className="lock-hint">🔒 {lockHint ?? '批量处理中，页面操作已锁定'}</span>
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
            <svg className="overlay" viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="none">
              {page.bubbles.map(b => (
                <rect
                  key={b.id}
                  x={b.box[0]} y={b.box[1]} width={b.box[2]} height={b.box[3]}
                  className={`bubble-rect ${b.id === selectedBubbleId ? 'selected' : ''} ${b.translated_text ? 'done' : ''}`}
                  onClick={() => onBubbleClick(b)}
                />
              ))}
            </svg>
          )}
          {viewMode === 'output' && page.status !== 'rendered' && (
            <div className="output-hint">尚未渲染译文图，点击上方「渲染译文图」生成</div>
          )}
        </div>
      </div>
    </div>
  );
}
