import { useEffect, useRef, useState } from 'react';
import type { Bubble, Page, Project } from '../types';
import { renderPage, saveBubble } from '../api';

interface Props {
  project: Project;
  page: Page;
  selectedBubble: Bubble | null;
  onProjectUpdate: (p: Project) => void;
  onRendered: () => void;
  onDeleteBubble: (bid: string) => Promise<void>;
  locked: boolean;
}

export default function BubblePanel({ project, page, selectedBubble, onProjectUpdate, onRendered, onDeleteBubble, locked }: Props) {
  const [text, setText] = useState('');
  const [box, setBox] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [fontSize, setFontSize] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // true when the user typed a geometry edit not yet auto-saved
  const geomDirty = useRef(false);

  // switch bubble: reset all editor state
  useEffect(() => {
    geomDirty.current = false;
    setText(selectedBubble?.translated_text ?? '');
    setBox(selectedBubble ? [...selectedBubble.box] : [0, 0, 0, 0]);
    setFontSize(selectedBubble?.font_size ? String(selectedBubble.font_size) : '');
    setSaved(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBubble?.id]);

  // same bubble, box changed elsewhere (e.g. dragged in viewer): sync inputs only
  useEffect(() => {
    if (selectedBubble) setBox([...selectedBubble.box]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBubble?.box]);

  // auto-save geometry (box / font_size) shortly after the user stops editing
  useEffect(() => {
    if (!selectedBubble || locked || !geomDirty.current) return;
    const [x, y, w, h] = box;
    if (![x, y, w, h].every(Number.isFinite) || w < 10 || h < 10) return;
    const fs = fontSize.trim() === '' ? null : Number(fontSize);
    if (fs !== null && (!Number.isFinite(fs) || fs < 6 || fs > 200)) return;
    const t = setTimeout(async () => {
      geomDirty.current = false;
      try {
        const updated = await saveBubble(project.id, page.id, selectedBubble.id, { box, font_size: fs });
        onProjectUpdate({
          ...project,
          pages: project.pages.map(p =>
            p.id === page.id ? { ...p, bubbles: p.bubbles.map(b => (b.id === updated.id ? updated : b)) } : p,
          ),
        });
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, fontSize, selectedBubble?.id]);

  if (!selectedBubble) {
    return (
      <aside className="bubble-panel">
        <h3>译文编辑</h3>
        <p className="hint">在中间页面点击一个气泡框，此处将显示原文与译文供编辑。</p>
      </aside>
    );
  }

  function setBoxAt(i: number, v: string) {
    const n = Number(v);
    const next = [...box] as [number, number, number, number];
    next[i] = Number.isFinite(n) ? Math.round(n) : 0;
    setBox(next);
    setSaved(false);
    geomDirty.current = true;
  }

  async function handleSave(reRender: boolean) {
    if (!selectedBubble) return;
    setBusy(true);
    setError(null);
    try {
      const fs = fontSize.trim() === '' ? null : Number(fontSize);
      if (fs !== null && (!Number.isFinite(fs) || fs < 6 || fs > 200)) {
        throw new Error('字号须为 6-200 的数字，或留空表示自动');
      }
      const updated = await saveBubble(project.id, page.id, selectedBubble.id, {
        translated_text: text,
        box,
        font_size: fs,
      });
      const newProject: Project = {
        ...project,
        pages: project.pages.map(p =>
          p.id === page.id ? { ...p, bubbles: p.bubbles.map(b => (b.id === updated.id ? updated : b)) } : p,
        ),
      };
      if (reRender) {
        const res = await renderPage(project.id, page.id);
        const rendered = res.page;
        newProject.pages = newProject.pages.map(p => (p.id === rendered.id ? rendered : p));
        onRendered();
      }
      onProjectUpdate(newProject);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="bubble-panel">
      <h3>气泡 {selectedBubble.id} {selectedBubble.edited && <span className="edited-tag">已手动编辑</span>}</h3>
      <label>日文原文</label>
      <div className="source-text">{selectedBubble.source_text || '（空）'}</div>
      <label>译文（可编辑）</label>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setSaved(false); }}
        rows={5}
        placeholder={locked ? '🔒 批量处理中，暂不可编辑' : '输入译文…'}
        disabled={locked}
      />
      <label>位置与大小（拖拽或输入，改动自动保存）</label>
      <div className="box-editor">
        {(['X', 'Y', '宽', '高'] as const).map((label, i) => (
          <span key={label} className="box-field">
            <em>{label}</em>
            <input
              type="number"
              value={box[i]}
              min={i >= 2 ? 10 : undefined}
              disabled={locked}
              onChange={e => setBoxAt(i, e.target.value)}
            />
          </span>
        ))}
      </div>
      <label>译文字号（留空 = 自动适配，改动自动保存）</label>
      <div className="box-editor">
        <span className="box-field">
          <em>字号</em>
          <input
            type="number"
            value={fontSize}
            placeholder="自动"
            min={6}
            max={200}
            disabled={locked}
            onChange={e => { setFontSize(e.target.value); setSaved(false); geomDirty.current = true; }}
          />
        </span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="panel-actions">
        <button className="primary" disabled={busy || locked} onClick={() => handleSave(true)}>{busy ? '保存中…' : '保存并重新渲染'}</button>
        <button className="danger" disabled={busy || locked} onClick={() => onDeleteBubble(selectedBubble.id)}>
          删除此气泡
        </button>
        {saved && <span className="saved-flag">已保存 ✓</span>}
      </div>
    </aside>
  );
}
