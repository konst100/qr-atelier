import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDestination, createQr, QrServiceError, resolveDestination, validateDestination, validateSlug } from '../server/qr-service.ts';
import { SqlAccountStore, SqlQrStore } from '../server/sql-store.ts';
import { hashPassword } from '../lib/account.ts';

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

test('SQL stores keep driver details outside the domain services', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM users')) return [{
        id: 'user_12345', email: 'owner@example.com', display_name: 'Owner',
        password_algorithm: 'PBKDF2-SHA-256', password_iterations: 210000,
        password_salt: 'salt', password_hash: 'hash', email_verified_at: null,
        created_at: '2026-09-15T10:00:00.000Z', updated_at: '2026-09-15T10:00:00.000Z',
      }];
      if (sql.includes('FROM qr_codes')) return [{
        id: 'qr_12345', workspace_id: 'workspace_a', slug: 'summer-2026', kind: 'url',
        name: 'Summer', status: 'active', design_json: '{}', folder_id: null,
        campaign_id: null, expires_at: null, created_at: '2026-09-15T10:00:00.000Z',
        updated_at: '2026-09-15T10:00:00.000Z',
      }];
      if (sql.includes('FROM qr_destinations')) return [];
      return [];
    },
  };
  const accountStore = new SqlAccountStore(client);
  const account = await accountStore.findByEmail('owner@example.com');
  assert.equal(account.password.algorithm, 'PBKDF2-SHA-256');
  const digest = await hashPassword('correct horse battery staple');
  await accountStore.create({ ...account, id: 'user_67890', password: digest });
  const qrStore = new SqlQrStore(client);
  assert.equal((await qrStore.getQrInWorkspace('workspace_a', 'qr_12345')).slug, 'summer-2026');
  assert.equal(calls.filter(({ sql }) => sql.includes('FROM')).length, 2);
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO users') && params.includes('user_67890')));
});
