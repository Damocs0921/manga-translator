import type { Page } from '../types';
import { pageImageUrl } from '../api';

interface Props {
  projectId: string;
  pages: Page[];
  selectedPageId: string | null;
  onPageSelect: (p: Page) => void;
}

export default function PageSidebar({ projectId, pages, selectedPageId, onPageSelect }: Props) {
  return (
    <nav className="sidebar">
      <h3>页面（{pages.length}）</h3>
      <div className="thumb-list">
        {pages.map(p => (
          <button
            key={p.id}
            className={`thumb ${p.id === selectedPageId ? 'active' : ''}`}
            onClick={() => onPageSelect(p)}
          >
            <img src={pageImageUrl(projectId, p.id)} alt={p.id} loading="lazy" />
            <span className={`dot st-${p.status}`} title={p.status} />
            <span className="thumb-name">{p.id.replace('page_', 'P')}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
