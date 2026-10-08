export interface Bubble {
  id: string;
  box: [number, number, number, number]; // x, y, w, h (pixels)
  source_text: string;
  translated_text: string;
  edited: boolean;
  font_size?: number | null; // null/undefined = auto-fit
}

export interface Page {
  id: string;
  file: string;
  width: number;
  height: number;
  status: 'pending' | 'detected' | 'translated' | 'rendered';
  bubbles: Bubble[];
}

export interface Project {
  id: string;
  name: string;
  target_lang: 'zh' | 'en';
  pages: Page[];
}

export interface BatchStatus {
  running: boolean;
  total: number;
  done: number;
  current: string;
  errors: { page: string; error: string }[];
  page_ids: string[]; // pages in the batch queue (queued + in-progress)
}
