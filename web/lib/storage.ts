import { buildPayload, initialDraft, type QrDraft } from './qr.ts';
export const LIBRARY_KEY = 'qr-atelier.library.v1';
export const LANGUAGE_KEY = 'qr-atelier.language';
export type SavedQr = { id: string; updatedAt: string; draft: QrDraft };

// Only the selected kind is retained; passwords and fields from other tabs
// are never carried into a saved record.
export function savedDraft(draft: QrDraft): QrDraft {
  if (draft.kind === 'wifi') throw new Error('Wi-Fi records cannot be saved');
  const clean = { ...initialDraft, url: '', kind: draft.kind, name: draft.name.trim().slice(0, 80), color: draft.color, shape: draft.shape };
  if (draft.kind === 'url') clean.url = draft.url;
  if (draft.kind === 'text') clean.text = draft.text;
  if (draft.kind === 'contact') {
    for (const key of ['firstName', 'lastName', 'phone', 'email', 'organization'] as const) clean[key] = draft[key];
  }
  return clean;
}
export function parseLibrary(raw: string | null): SavedQr[] {
  if (!raw) return [];
  const input: unknown = JSON.parse(raw);
  if (!Array.isArray(input) || input.length > 100) throw new Error('Invalid library');
  return input.map((record) => {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || record.id.length > 80 ||
        typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt)) || !record.draft || typeof record.draft !== 'object') throw new Error('Invalid record');
    const value = record.draft;
    for (const key of Object.keys(initialDraft)) {
      if (typeof value[key] !== 'string' || value[key].length > 1400) throw new Error('Invalid field');
    }
    if (!['url', 'text', 'contact'].includes(value.kind) || !['square', 'rounded'].includes(value.shape) || buildPayload(value).error) throw new Error('Invalid payload');
    return { id: record.id, updatedAt: record.updatedAt, draft: savedDraft(value) };
  });
}
