import assert from 'node:assert/strict';
import test from 'node:test';
import { hydrateRemoteQr, isDynamicQr } from '../lib/cabinet.ts';
import { buildPayload, initialDraft } from '../lib/qr.ts';

const qr = { id: 'test-qr', workspaceId: 'workspace', slug: 'stable-qr', kind: 'url', name: 'Server title', status: 'paused', designJson: '{}', destinationUrl: 'https://example.com/latest', createdAt: '2026-09-15T10:00:00Z', updatedAt: '2026-09-15T10:00:00Z' };

test('legacy server records remain editable and use the authoritative destination and slug', () => {
  const record = hydrateRemoteQr(qr);
  assert.equal(record.draft.url, qr.destinationUrl);
  assert.equal(record.draft.name, qr.name);
  assert.equal(record.draft.slug, qr.slug);
  assert.equal(record.server.status, 'paused');
  assert.equal(isDynamicQr(record), true);
  assert.equal(buildPayload(record.draft).error, undefined);
});

test('stored artwork survives hydration while server metadata overrides stale design fields', () => {
  const design = { ...initialDraft, mode: 'dynamic', slug: 'outdated-slug', url: 'https://example.com/old', name: 'Old title', color: '#172554', logoDataUrl: 'data:image/png;base64,AAAA' };
  const record = hydrateRemoteQr({ ...qr, designJson: JSON.stringify(design) });
  assert.equal(record.draft.logoDataUrl, design.logoDataUrl);
  assert.equal(record.draft.name, qr.name);
  assert.equal(record.draft.url, qr.destinationUrl);
  assert.equal(record.draft.slug, qr.slug);
});

test('static URL and text records never advertise dynamic statistics or pause controls', () => {
  assert.equal(isDynamicQr(hydrateRemoteQr({ ...qr, designJson: JSON.stringify({ ...initialDraft, mode: 'static' }) })), false);
  const text = hydrateRemoteQr({ ...qr, kind: 'text', destinationUrl: null, designJson: JSON.stringify({ ...initialDraft, kind: 'text', mode: 'dynamic', text: 'A message' }) });
  assert.equal(text.draft.mode, 'static');
  assert.equal(buildPayload(text.draft).payload, 'A message');
  assert.equal(isDynamicQr(text), false);
});

test('dynamic slug validation matches the advertised six character minimum', () => {
  assert.equal(buildPayload({ ...initialDraft, mode: 'dynamic', slug: 'a' }).error, 'slugInvalid');
  assert.equal(buildPayload({ ...initialDraft, mode: 'dynamic', slug: 'abcdef' }).error, undefined);
});
