import type { BatchStatus, Bubble, Page, Project } from './types';

const BASE = '/api';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function uploadPdf(file: File): Promise<Project> {
  const form = new FormData();
  form.append('file', file);
  return json<Project>(await fetch(`${BASE}/upload`, { method: 'POST', body: form }));
}

export async function listProjects(): Promise<Project[]> {
  return json<Project[]>(await fetch(`${BASE}/projects`));
}

export async function getProject(pid: string): Promise<Project> {
  return json<Project>(await fetch(`${BASE}/projects/${pid}`));
}

export async function setTargetLang(pid: string, lang: 'zh' | 'en'): Promise<Project> {
  return json<Project>(await fetch(`${BASE}/projects/${pid}/target_lang?lang=${lang}`, { method: 'PUT' }));
}

export async function detectPage(pid: string, pageId: string): Promise<Page> {
  return json<Page>(await fetch(`${BASE}/projects/${pid}/pages/${pageId}/detect`, { method: 'POST' }));
}

export async function translatePage(pid: string, pageId: string): Promise<Page> {
  return json<Page>(await fetch(`${BASE}/projects/${pid}/pages/${pageId}/translate`, { method: 'POST' }));
}

export interface BubblePatch {
  translated_text?: string;
  box?: number[];
  font_size?: number | null;
}

export async function saveBubble(
  pid: string, pageId: string, bid: string, patch: BubblePatch,
): Promise<Bubble> {
  return json<Bubble>(
    await fetch(`${BASE}/projects/${pid}/pages/${pageId}/bubbles/${bid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  );
}

export async function deleteBubble(pid: string, pageId: string, bid: string): Promise<Page> {
  return json<Page>(
    await fetch(`${BASE}/projects/${pid}/pages/${pageId}/bubbles/${bid}`, { method: 'DELETE' }),
  );
}

export async function renderPage(pid: string, pageId: string): Promise<{ page: Page }> {
  return json<{ page: Page }>(await fetch(`${BASE}/projects/${pid}/pages/${pageId}/render`, { method: 'POST' }));
}

export async function startBatch(pid: string, pageIds: string[]): Promise<{ ok: boolean }> {
  return json<{ ok: boolean }>(
    await fetch(`${BASE}/projects/${pid}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_ids: pageIds }),
    }),
  );
}

export async function getBatchStatus(pid: string): Promise<BatchStatus> {
  return json<BatchStatus>(await fetch(`${BASE}/projects/${pid}/batch/status`));
}

export function pageImageUrl(pid: string, pageId: string): string {
  return `${BASE}/projects/${pid}/pages/${pageId}/image`;
}

export function pageOutputUrl(pid: string, pageId: string): string {
  return `${BASE}/projects/${pid}/pages/${pageId}/output`;
}

export function exportUrl(pid: string): string {
  return `${BASE}/projects/${pid}/export`;
}

export function exportPdfUrl(pid: string): string {
  return `${BASE}/projects/${pid}/export_pdf`;
}
