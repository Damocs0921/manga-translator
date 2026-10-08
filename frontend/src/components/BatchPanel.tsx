import { useEffect, useRef, useState } from 'react';
import type { BatchStatus, Project } from '../types';
import { exportPdfUrl, exportUrl, getBatchStatus, startBatch } from '../api';

interface Props {
  project: Project;
  onProjectUpdate: (p: Project) => void;
  onStatusChange: (st: BatchStatus) => void;
}

export default function BatchPanel({ project, onProjectUpdate, onStatusChange }: Props) {
  const [status, setStatus] = useState<BatchStatus>({ running: false, total: 0, done: 0, current: '', errors: [], page_ids: [] });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const projectId = project.id;

  function updateStatus(st: BatchStatus) {
    setStatus(st);
    onStatusChange(st);
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    // initialize selection to unrendered pages when project changes
    setSelected(Object.fromEntries(project.pages.map(p => [p.id, p.status !== 'rendered'])));
    // check if a batch is already running (e.g. after page reload) and resume polling
    getBatchStatus(projectId).then(st => {
      updateStatus(st);
      if (st.running) poll();
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function poll() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      const st = await getBatchStatus(projectId);
      updateStatus(st);
      if (!st.running) {
        if (timerRef.current) clearInterval(timerRef.current);
        const res = await fetch(`/api/projects/${projectId}`);
        if (res.ok) onProjectUpdate(await res.json());
      }
    }, 2000);
  }

  async function start() {
    const ids = project.pages.filter(p => selected[p.id]).map(p => p.id);
    if (!ids.length) return;
    updateStatus({ running: true, total: ids.length, done: 0, current: '', errors: [], page_ids: ids });
    await startBatch(projectId, ids);
    poll();
  }

  const allSelected = project.pages.length > 0 && project.pages.every(p => selected[p.id]);
  const renderedCount = project.pages.filter(p => p.status === 'rendered').length;
  const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <div className="batch-panel">
      <h3>批量自动处理</h3>
      <div className="batch-select">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={e => setSelected(Object.fromEntries(project.pages.map(p => [p.id, e.target.checked])))}
          />
          全选（{project.pages.filter(p => selected[p.id]).length}/{project.pages.length}）
        </label>
        {project.pages.map(p => (
          <label key={p.id} className="page-check">
            <input
              type="checkbox"
              checked={!!selected[p.id]}
              onChange={e => setSelected(s => ({ ...s, [p.id]: e.target.checked }))}
            />
            {p.id.replace('page_', 'P')}
            <span className={`dot st-${p.status}`} />
          </label>
        ))}
      </div>
      <button className="primary" disabled={status.running} onClick={start}>
        {status.running ? `处理中 ${pct}%` : '开始批量处理（检测→翻译→渲染）'}
      </button>
      {status.total > 0 && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}
      {status.running && status.current && <div className="hint">正在处理：{status.current}</div>}
      {!status.running && status.total > 0 && status.done === status.total && (
        <div className="hint">批量完成{status.errors.length > 0 && `（${status.errors.length} 个失败）`}</div>
      )}
      {status.errors.map((e, i) => (
        <div key={i} className="error">{e.page}: {e.error}</div>
      ))}
      <div className="export-row">
        <a
          className={`button ${renderedCount ? '' : 'disabled'}`}
          href={renderedCount ? exportUrl(projectId) : undefined}
        >
          导出全部译文图（ZIP）
        </a>
        <a
          className={`button pdf ${renderedCount ? '' : 'disabled'}`}
          href={renderedCount ? exportPdfUrl(projectId) : undefined}
        >
          合并导出 PDF
        </a>
      </div>
      <span className="hint">{renderedCount}/{project.pages.length} 页已渲染</span>
    </div>
  );
}
