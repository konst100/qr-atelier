import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDestination, createQr, QrServiceError, resolveDestination, validateDestination, validateSlug } from '../server/qr-service.ts';

function makeStore() {
  const qrs = new Map();
  const destinations = new Map();
  return {
    qrs,
    destinations,
    createQr: async (record) => { qrs.set(record.id, record); },
    getQrInWorkspace: async (workspaceId, id) => {
      const record = qrs.get(id);
      return record?.workspaceId === workspaceId ? record : null;
    },
    getQrBySlug: async (slug) => [...qrs.values()].find((record) => record.slug === slug) ?? null,
    listQrInWorkspace: async (workspaceId) => [...qrs.values()].filter((record) => record.workspaceId === workspaceId),
    createDestination: async (destination) => { destinations.set(destination.id, destination); },
    listDestinations: async (qrCodeId) => [...destinations.values()].filter((destination) => destination.qrCodeId === qrCodeId),
  };
}

test('slugs and destinations are normalized and validated', () => {
  assert.equal(validateSlug('  Summer-2026 '), 'summer-2026');
  assert.equal(validateDestination(' https://example.com/Grüße '), 'https://example.com/Gr%C3%BC%C3%9Fe');
  for (const slug of ['short', 'contains_underscore', 'has space', 'a'.repeat(65)]) {
    assert.throws(() => validateSlug(slug), (error) => error instanceof QrServiceError && error.code === 'invalidSlug');
  }
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'not-a-url']) {
    assert.throws(() => validateDestination(url), (error) => error instanceof QrServiceError && error.code === 'invalidDestination');
  }
});

test('workspace ownership prevents adding a destination to another workspace', async () => {
  const store = makeStore();
  await createQr(store, { workspaceId: 'workspace_a', id: 'qr_12345', slug: 'summer-2026', kind: 'url', name: 'Summer' }, new Date('2026-09-15T10:00:00Z'));
  await assert.rejects(() => addDestination(store, 'workspace_b', { qrCodeId: 'qr_12345', destinationUrl: 'https://example.com' }), (error) => error.code === 'qrNotFound');
  const destination = await addDestination(store, 'workspace_a', { qrCodeId: 'qr_12345', id: 'dest_12345', destinationUrl: 'https://example.com' });
  assert.equal(destination.destinationUrl, 'https://example.com/');
});

test('old QR image resolves to the newest active destination', async () => {
  const store = makeStore();
  const now = new Date('2026-09-15T12:00:00Z');
  await createQr(store, { workspaceId: 'workspace_a', id: 'qr_12345', slug: 'summer-2026', kind: 'url', name: 'Summer' }, now);
  await addDestination(store, 'workspace_a', { qrCodeId: 'qr_12345', id: 'dest_old', destinationUrl: 'https://old.example', startsAt: new Date('2026-09-15T10:00:00Z') }, now);
  await addDestination(store, 'workspace_a', { qrCodeId: 'qr_12345', id: 'dest_new', destinationUrl: 'https://new.example', startsAt: new Date('2026-09-15T11:00:00Z') }, now);
  assert.equal(await resolveDestination(store, 'summer-2026', now), 'https://new.example/');
  assert.equal(await resolveDestination(store, 'summer-2026', new Date('2026-09-15T10:30:00Z')), 'https://old.example/');
  assert.equal(await resolveDestination(store, 'missing-1', now), null);
});

test('expired or paused QR codes do not redirect', async () => {
  const store = makeStore();
  const now = new Date('2026-09-15T12:00:00Z');
  const qr = await createQr(store, { workspaceId: 'workspace_a', id: 'qr_12345', slug: 'summer-2026', kind: 'url', name: 'Summer' }, now);
  await addDestination(store, 'workspace_a', { qrCodeId: qr.id, destinationUrl: 'https://example.com' }, now);
  qr.status = 'paused';
  assert.equal(await resolveDestination(store, qr.slug, now), null);
  qr.status = 'active';
  qr.expiresAt = '2026-09-15T11:00:00.000Z';
  assert.equal(await resolveDestination(store, qr.slug, now), null);
});
