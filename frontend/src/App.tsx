import { useEffect, useRef, useState } from 'react';
import type { BatchStatus, Bubble, Page, Project } from './types';
import { deleteBubble, getProject, listProjects, renderPage, saveBubble, setTargetLang, uploadPdf } from './api';
import PageSidebar from './components/PageSidebar';
import PageViewer from './components/PageViewer';
import BubblePanel from './components/BubblePanel';
import BatchPanel from './components/BatchPanel';

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'source' | 'output'>('source');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus>({ running: false, total: 0, done: 0, current: '', errors: [], page_ids: [] });
  // bump whenever a page output is re-rendered, to bust the cached output image
  const [renderStamp, setRenderStamp] = useState(Date.now());
  const handleRendered = () => {
    setViewMode('output');
    setRenderStamp(Date.now());
  };
  // only pages inside the batch queue (queued or in-progress) are locked
  const isLocked = (pageId: string | null): boolean =>
    !!pageId && batchStatus.running && batchStatus.page_ids.includes(pageId);
  const lockHintFor = (pageId: string | null): string =>
    batchStatus.current === pageId
      ? '正在处理本页，操作已锁定'
      : '本页在批量队列中，操作已锁定';

  useEffect(() => {
    listProjects().then(ps => setProjects(ps)).catch(() => {});
  }, []);

  const page: Page | null = project?.pages.find(p => p.id === selectedPageId) ?? null;
  const bubble: Bubble | null = page?.bubbles.find(b => b.id === selectedBubbleId) ?? null;

  // delete a bubble; if the page already has a rendered output, re-render it automatically
  async function deleteBubbleAndRefresh(bid: string) {
    if (!project || !page) return;
    try {
      const updatedPage = await deleteBubble(project.id, page.id, bid);
      let next: Project = {
        ...project,
        pages: project.pages.map(p => (p.id === updatedPage.id ? updatedPage : p)),
      };
      if (updatedPage.status === 'rendered') {
        const res = await renderPage(project.id, page.id);
        next = { ...next, pages: next.pages.map(p => (p.id === res.page.id ? res.page : p)) };
        setRenderStamp(Date.now());
      }
      setSelectedBubbleId(null);
      setProject(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Backspace/Delete removes the selected bubble (unless typing in a field)
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const deletingRef = useRef(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      const b = bubbleRef.current;
      const pg = page;
      if (!b || !pg || isLocked(pg.id) || deletingRef.current) return;
      e.preventDefault();
      deletingRef.current = true;
      deleteBubbleAndRefresh(b.id).finally(() => { deletingRef.current = false; });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, isLocked]);

  async function handleUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const p = await uploadPdf(file);
      setProject(p);
      setSelectedPageId(p.pages[0]?.id ?? null);
      setSelectedBubbleId(null);
      setProjects(await listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openProject(pid: string) {
    setBusy(true);
    try {
      const p = await getProject(pid);
      setProject(p);
      setSelectedPageId(p.pages[0]?.id ?? null);
      setSelectedBubbleId(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>📚 漫画翻译器</h1>
        <label className="upload-btn">
          {busy ? '处理中…' : '导入 PDF'}
          <input
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          />
        </label>
        {project && (
          <>
            <span className="proj-name">{project.name}</span>
            <select
              value={project.target_lang}
              onChange={async e => {
                const p = await setTargetLang(project.id, e.target.value as 'zh' | 'en');
                setProject(p);
              }}
            >
              <option value="zh">日 → 中</option>
              <option value="en">日 → 英</option>
            </select>
            <div className="view-toggle">
              <button className={viewMode === 'source' ? 'active' : ''} onClick={() => setViewMode('source')}>原图</button>
              <button className={viewMode === 'output' ? 'active' : ''} onClick={() => setViewMode('output')}>译文图</button>
            </div>
          </>
        )}
      </header>
      {error && <div className="error global-error">{error}</div>}
      {project ? (
        <main className="layout">
          <PageSidebar
            projectId={project.id}
            pages={project.pages}
            selectedPageId={selectedPageId}
            onPageSelect={p => {
              setSelectedPageId(p.id);
              setSelectedBubbleId(null);
              // a page without rendered output has nothing to show in output view
              if (p.status !== 'rendered') setViewMode('source');
            }}
          />
          {page && (
            <PageViewer
              project={project}
              page={page}
              selectedBubbleId={selectedBubbleId}
              viewMode={viewMode}
              onBubbleClick={b => setSelectedBubbleId(b.id === selectedBubbleId ? null : b.id)}
              onProjectUpdate={setProject}
              onRendered={handleRendered}
              onTranslated={p => setSelectedBubbleId(p.bubbles[0]?.id ?? null)}
              onBubbleGeometry={async (bid, box) => {
                if (!project || !page) return;
                try {
                  const updated = await saveBubble(project.id, page.id, bid, { box });
                  setProject({
                    ...project,
                    pages: project.pages.map(p =>
                      p.id === page.id ? { ...p, bubbles: p.bubbles.map(b => (b.id === updated.id ? updated : b)) } : p,
                    ),
                  });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
              locked={isLocked(page.id)}
              lockHint={lockHintFor(page.id)}
              renderStamp={renderStamp}
            />
          )}
          <div className="right-col">
            <BubblePanel
              project={project}
              page={page}
              selectedBubble={bubble}
              onProjectUpdate={setProject}
              onRendered={handleRendered}
              onDeleteBubble={deleteBubbleAndRefresh}
              locked={isLocked(page.id)}
            />
            <BatchPanel
              project={project}
              onProjectUpdate={p => { setProject(p); setRenderStamp(Date.now()); }}
              onStatusChange={setBatchStatus}
            />
          </div>
        </main>
      ) : (
        <div className="welcome">
          <h2>导入一本日漫 PDF 开始翻译</h2>
          <p>流程：导入 PDF → 自动拆页 → AI 检测气泡并 OCR → AI 翻译 → 编辑译文 → 嵌回图片导出</p>
          {projects.length > 0 && (
            <div className="history">
              <h3>最近项目</h3>
              {projects.map(p => (
                <button key={p.id} onClick={() => openProject(p.id)}>
                  {p.name}（{p.pages.length} 页）
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
