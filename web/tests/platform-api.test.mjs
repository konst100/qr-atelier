import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqlScanStore, SqlSessionStore, SqlWorkspaceAccess } from '../server/sql-store.ts';
import { handleRedirectRequest } from '../server/redirect-api.ts';
import { handleAppRequest } from '../server/router.ts';
import { handleQrRequest } from '../server/qr-api.ts';
import { handleStatsRequest } from '../server/stats-api.ts';

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

test('QR cabinet updates, pauses, archives, and rotates the destination', async () => {
  const sessions = new Map([['session_hash', { tokenHash: 'session_hash', userId: 'user_1', expiresAt: '2026-09-15T11:00:00.000Z' }]]);
  const qr = {
    id: 'qr_1', workspaceId: 'workspace_1', slug: 'summer-2026', kind: 'url', name: 'Summer',
    status: 'active', designJson: '{}', folderId: null, campaignId: null, expiresAt: null,
    createdAt: '2026-09-15T09:00:00.000Z', updatedAt: '2026-09-15T09:00:00.000Z',
  };
  const destinations = [];
  const qrs = {
    getQrInWorkspace: async (workspaceId, id) => workspaceId === qr.workspaceId && id === qr.id ? qr : null,
    getQrBySlug: async () => qr,
    listQrInWorkspace: async () => [qr],
    createQr: async () => {},
    updateQr: async (next) => Object.assign(qr, next),
    createDestination: async (destination) => { destinations.push(destination); },
    listDestinations: async () => destinations,
  };
  const deps = {
    sessions: { find: async (hash) => sessions.get(hash) ?? null },
    workspaces: { defaultForUser: async () => ({ id: qr.workspaceId, name: 'Owner workspace' }) },
    qrs,
    now: () => new Date('2026-09-15T10:00:00.000Z'),
  };
  const cookie = 'qr_session=raw-token';
  // hashSessionToken('raw-token') is intentionally supplied by the dependency below.
  deps.sessions.find = async () => [...sessions.values()][0];
  const patchResponse = await handleQrRequest(new Request('https://app.test/api/qr/qr_1', {
    method: 'PATCH', headers: { Cookie: cookie },
    body: JSON.stringify({ name: ' Updated ', status: 'paused', destinationUrl: 'https://example.com/updated' }),
  }), deps);
  assert.equal(patchResponse.status, 200);
  assert.equal(qr.name, 'Updated');
  assert.equal(qr.status, 'paused');
  assert.equal(destinations.length, 1);
  const deleted = await handleQrRequest(new Request('https://app.test/api/qr/qr_1', { method: 'DELETE', headers: { Cookie: cookie } }), deps);
  assert.equal(deleted.status, 204);
  assert.equal(qr.status, 'archived');
});

test('scan statistics aggregate by day and stay scoped to the QR workspace', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT scans')) return [{ scans: 2, device_mobile: 1, device_desktop: 1 }];
      if (sql.includes('SELECT day')) return [{ day: '2026-09-15', scans: 3, device_mobile: 2, device_desktop: 1 }];
      return [];
    },
  };
  const scanStore = new SqlScanStore(client);
  await scanStore.record({ qrCodeId: 'qr_1', day: '2026-09-15', device: 'mobile' });
  assert.deepEqual(await scanStore.listDaily('qr_1', '2026-09-01', '2026-09-30'), [{ day: '2026-09-15', scans: 3, deviceMobile: 2, deviceDesktop: 1 }]);
  const stats = await handleStatsRequest(new Request('https://app.test/api/qr/qr_1/stats?from=2026-09-01&to=2026-09-30', { headers: { Cookie: 'qr_session=raw-token' } }), {
    sessions: { find: async () => ({ tokenHash: 'hash', userId: 'user_1', expiresAt: '2026-10-01T00:00:00.000Z' }) },
    workspaces: { defaultForUser: async () => ({ id: 'workspace_1', name: 'Owner workspace' }) },
    qrs: { getQrInWorkspace: async () => ({ id: 'qr_1' }), listDestinations: async () => [] },
    scans: scanStore,
    now: () => new Date('2026-09-15T10:00:00.000Z'),
  });
  assert.equal(stats.status, 200);
  assert.equal((await stats.json()).total, 3);
  assert.match(calls.at(-1).sql, /day >=/);
});
