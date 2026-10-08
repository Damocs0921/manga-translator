import { useEffect, useState } from 'react';
import type { Bubble, Page, Project } from '../types';
import { renderPage, saveBubble } from '../api';

interface Props {
  project: Project;
  page: Page;
  selectedBubble: Bubble | null;
  onProjectUpdate: (p: Project) => void;
  onRendered: () => void;
  locked: boolean;
}

export default function BubblePanel({ project, page, selectedBubble, onProjectUpdate, onRendered, locked }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setText(selectedBubble?.translated_text ?? '');
    setSaved(false);
  }, [selectedBubble?.id]);

  if (!selectedBubble) {
    return (
      <aside className="bubble-panel">
        <h3>译文编辑</h3>
        <p className="hint">在中间页面点击一个气泡框，此处将显示原文与译文供编辑。</p>
      </aside>
    );
  }

  async function handleSave(reRender: boolean) {
    if (!selectedBubble) return;
    setBusy(true);
    try {
      const updated = await saveBubble(project.id, page.id, selectedBubble.id, text);
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
      <div className="panel-actions">
        <button disabled={busy || locked} onClick={() => handleSave(false)}>{busy ? '保存中…' : '保存译文'}</button>
        <button className="primary" disabled={busy || locked} onClick={() => handleSave(true)}>保存并重新渲染</button>
        {saved && <span className="saved-flag">已保存 ✓</span>}
      </div>
    </aside>
  );
}
