import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialDraft } from '../lib/qr.ts';
import { parseLibrary } from '../lib/storage.ts';

test('library restores a legacy record and a valid larger logo data URL', () => {
  const record = {
    id: 'qr_legacy',
    updatedAt: '2026-09-15T10:00:00.000Z',
    draft: { ...initialDraft, name: 'Brand', logoDataUrl: `data:image/png;base64,${'A'.repeat(2000)}` },
  };
  const parsed = parseLibrary(JSON.stringify([record]));
  assert.equal(parsed[0].draft.name, 'Brand');
  assert.equal(parsed[0].draft.logoDataUrl.length, record.draft.logoDataUrl.length);
});
