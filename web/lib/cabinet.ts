import type { ApiQrCode } from './api-client.ts';
import { initialDraft, type QrDraft } from './qr.ts';
import { savedDraft, type SavedQr } from './storage.ts';

export type LibraryQr = SavedQr & { server?: { status: ApiQrCode['status']; slug: string } };

/** Server metadata remains authoritative even for older records without design data. */
export function hydrateRemoteQr(record: ApiQrCode): LibraryQr {
  let design: Partial<QrDraft> = {};
  try {
    const parsed: unknown = JSON.parse(record.designJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) design = parsed as Partial<QrDraft>;
  } catch { /* older records can still be opened with their server metadata */ }
  const draft: QrDraft = {
    ...initialDraft, ...design,
    kind: record.kind as QrDraft['kind'], name: record.name, slug: record.slug,
    url: record.destinationUrl ?? design.url ?? '',
    mode: record.kind === 'url' ? design.mode ?? 'dynamic' : 'static',
  };
  return { id: record.id, updatedAt: record.updatedAt, draft: savedDraft(draft), server: { status: record.status, slug: record.slug } };
}

export function isDynamicQr(record: LibraryQr): boolean {
  return !!record.server && record.draft.kind === 'url' && record.draft.mode === 'dynamic';
}
