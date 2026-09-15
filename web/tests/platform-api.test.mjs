import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqlSessionStore, SqlWorkspaceAccess } from '../server/sql-store.ts';
import { handleRedirectRequest } from '../server/redirect-api.ts';
import { handleAppRequest } from '../server/router.ts';

test('SQL session and workspace adapters map rows without provider coupling', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM sessions')) return [{ token_hash: 'hash_1', user_id: 'user_1', expires_at: '2026-09-15T11:00:00.000Z' }];
      return [{ id: 'workspace_1', name: 'Owner workspace' }];
    },
  };
  const sessions = new SqlSessionStore(client, () => new Date('2026-09-15T10:00:00.000Z'));
  await sessions.save({ tokenHash: 'hash_1', userId: 'user_1', expiresAt: '2026-09-15T11:00:00.000Z' });
  assert.deepEqual(await sessions.find('hash_1'), { tokenHash: 'hash_1', userId: 'user_1', expiresAt: '2026-09-15T11:00:00.000Z' });
  const access = new SqlWorkspaceAccess(client);
  assert.deepEqual(await access.defaultForUser('user_1'), { id: 'workspace_1', name: 'Owner workspace' });
  assert.match(calls[0].sql, /INSERT INTO sessions/);
  assert.deepEqual(calls[0].params.slice(0, 3), ['hash_1', 'user_1', '2026-09-15T11:00:00.000Z']);
  assert.match(calls.at(-1).sql, /JOIN workspaces/);
});

test('redirect API returns the current destination and hides unavailable codes', async () => {
  const qr = {
    id: 'qr_1', workspaceId: 'workspace_1', slug: 'summer-2026', kind: 'url', name: 'Summer',
    status: 'active', designJson: '{}', folderId: null, campaignId: null, expiresAt: null,
    createdAt: '2026-09-15T09:00:00.000Z', updatedAt: '2026-09-15T09:00:00.000Z',
  };
  const qrs = {
    getQrBySlug: async (slug) => slug === qr.slug ? qr : null,
    listDestinations: async () => [{ id: 'dest_1', qrCodeId: qr.id, destinationUrl: 'https://example.com/new', startsAt: '2026-09-15T09:30:00.000Z', endsAt: null, createdAt: '2026-09-15T09:30:00.000Z' }],
  };
  const deps = { qrs, now: () => new Date('2026-09-15T10:00:00.000Z') };
  const response = await handleRedirectRequest(new Request('https://app.test/r/summer-2026'), deps);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://example.com/new');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const missing = await handleRedirectRequest(new Request('https://app.test/r/missing-1'), deps);
  assert.equal(missing.status, 404);
  assert.equal((await handleRedirectRequest(new Request('https://app.test/r/summer-2026', { method: 'POST' }), deps)).status, 405);
});

test('app router dispatches auth, QR cabinet, and redirect paths', async () => {
  const qrs = {
    getQrBySlug: async () => null,
    listDestinations: async () => [],
    listQrInWorkspace: async () => [],
    getQrInWorkspace: async () => null,
    createQr: async () => {},
    createDestination: async () => {},
  };
  const deps = {
    auth: { accounts: { findByEmail: async () => null, create: async () => {} }, sessions: { save: async () => {} } },
    qr: { sessions: { find: async () => null }, workspaces: { defaultForUser: async () => null }, qrs },
  };
  assert.equal((await handleAppRequest(new Request('https://app.test/api/auth/login', { method: 'GET' }), deps)).status, 405);
  assert.equal((await handleAppRequest(new Request('https://app.test/api/qr'), deps)).status, 401);
  assert.equal((await handleAppRequest(new Request('https://app.test/r/missing-1'), deps)).status, 404);
  assert.equal((await handleAppRequest(new Request('https://app.test/unknown'), deps)).status, 404);
});
