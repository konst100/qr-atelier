import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession, hashPassword, normalizeEmail, validateRegistration, verifyPassword } from '../lib/account.ts';
import { readFile } from 'node:fs/promises';
import { AccountServiceError, authenticateAccount, registerAccount } from '../server/account-service.ts';
import { handleAuthRequest } from '../server/auth-api.ts';
import { handleQrRequest } from '../server/qr-api.ts';

test('registration normalizes email and validates a strong password', () => {
  assert.deepEqual(validateRegistration({ email: '  USER@Example.COM ', password: 'correct horse battery staple' }), {
    data: { email: 'user@example.com', displayName: '' },
  });
  assert.equal(validateRegistration({ email: 'not-an-email', password: 'correct horse battery staple' }).error, 'emailInvalid');
  assert.equal(validateRegistration({ email: 'user@example.com', password: 'too-short' }).error, 'passwordInvalid');
  assert.equal(normalizeEmail(' A@B.Example '), 'a@b.example');
});

test('password digest is salted and verifies without storing the password', async () => {
  const password = 'correct horse battery staple';
  const digest = await hashPassword(password);
  assert.equal(digest.algorithm, 'PBKDF2-SHA-256');
  assert.notEqual(digest.hash, password);
  assert.notEqual(digest.salt, password);
  assert.equal(await verifyPassword(password, digest), true);
  assert.equal(await verifyPassword('wrong password', digest), false);
  const second = await hashPassword(password);
  assert.notEqual(second.salt, digest.salt);
  assert.notEqual(second.hash, digest.hash);
});

test('session exposes a raw token once and stores only its hash', async () => {
  const session = await createSession('user_12345', 60_000);
  assert.match(session.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(session.token, session.data.tokenHash);
  assert.equal(session.data.userId, 'user_12345');
  assert.ok(Date.parse(session.data.expiresAt) > Date.now());
  await assert.rejects(() => createSession('bad'), /Invalid user id/);
});

test('schema contains ownership and dynamic redirect tables without plaintext password', async () => {
  const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
  for (const name of ['users', 'workspaces', 'memberships', 'sessions', 'qr_codes', 'qr_destinations', 'scan_daily']) {
    assert.match(schema, new RegExp(`CREATE TABLE ${name}`));
  }
  assert.match(schema, /password_hash TEXT NOT NULL/);
  assert.doesNotMatch(schema, /password TEXT NOT NULL/);
  assert.match(schema, /workspace_id TEXT NOT NULL REFERENCES workspaces/);
  assert.match(schema, /slug TEXT NOT NULL UNIQUE/);
});

test('account service keeps registration and authentication provider-independent', async () => {
  const accounts = new Map();
  const store = {
    findByEmail: async (email) => accounts.get(email) ?? null,
    create: async (account) => { accounts.set(account.email, account); },
  };
  const account = await registerAccount(store, {
    email: 'Owner@Example.com', password: 'correct horse battery staple', displayName: ' Owner ',
  }, { id: 'user_12345', now: new Date('2026-09-15T10:00:00.000Z') });
  assert.deepEqual(account, {
    id: 'user_12345', email: 'owner@example.com', displayName: 'Owner', emailVerifiedAt: null,
    createdAt: '2026-09-15T10:00:00.000Z', updatedAt: '2026-09-15T10:00:00.000Z',
  });
  assert.equal(Object.hasOwn(account, 'password'), false);
  assert.equal((await authenticateAccount(store, 'OWNER@example.com', 'correct horse battery staple')).id, 'user_12345');
  await assert.rejects(() => authenticateAccount(store, 'owner@example.com', 'wrong'), (error) => error instanceof AccountServiceError && error.code === 'invalidCredentials');
  await assert.rejects(() => registerAccount(store, { email: 'owner@example.com', password: 'correct horse battery staple' }), (error) => error instanceof AccountServiceError && error.code === 'emailTaken');
});

test('auth API returns a secure session cookie and keeps transport separate from storage', async () => {
  const accounts = new Map();
  const sessions = [];
  const dependencies = {
    accounts: {
      findByEmail: async (email) => accounts.get(email) ?? null,
      create: async (account) => { accounts.set(account.email, account); },
    },
    sessions: { save: async (session) => { sessions.push(session); } },
    now: () => new Date('2026-09-15T10:00:00.000Z'),
  };
  const register = await handleAuthRequest(new Request('https://app.test/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery staple', displayName: 'Owner' }),
  }), dependencies);
  assert.equal(register.status, 201);
  assert.equal(register.headers.get('Cache-Control'), 'no-store');
  assert.match(register.headers.get('Set-Cookie'), /HttpOnly/);
  assert.match(register.headers.get('Set-Cookie'), /Secure/);
  assert.match(register.headers.get('Set-Cookie'), /SameSite=Lax/);
  assert.equal(sessions.length, 1);
  const registerBody = await register.json();
  assert.equal(registerBody.account.email, 'owner@example.com');
  assert.equal(Object.hasOwn(registerBody.account, 'password'), false);

  const login = await handleAuthRequest(new Request('https://app.test/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'OWNER@example.com', password: 'correct horse battery staple' }),
  }), dependencies);
  assert.equal(login.status, 200);
  assert.equal(sessions.length, 2);
});

test('auth API rejects malformed input, duplicate registration and wrong credentials', async () => {
  const store = { findByEmail: async () => null, create: async () => {} };
  const deps = { accounts: store, sessions: { save: async () => {} } };
  assert.equal((await handleAuthRequest(new Request('https://app.test/api/auth/register', { method: 'POST', body: '{' }), deps)).status, 400);
  assert.equal((await handleAuthRequest(new Request('https://app.test/api/auth/login', { method: 'GET' }), deps)).status, 405);
  assert.equal((await handleAuthRequest(new Request('https://app.test/other', { method: 'POST' }), deps)).status, 404);
  const wrong = await handleAuthRequest(new Request('https://app.test/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'wrong password' }),
  }), deps);
  assert.equal(wrong.status, 401);
});

test('auth API clears sessions and exposes only the public current account', async () => {
  const accounts = new Map();
  const sessions = new Map();
  const store = {
    findByEmail: async (email) => accounts.get(email) ?? null,
    findById: async (id) => [...accounts.values()].find((account) => account.id === id) ?? null,
    create: async (account) => { accounts.set(account.email, account); },
  };
  const deps = {
    accounts,
    sessions: {
      save: async (session) => { sessions.set(session.tokenHash, session); },
      find: async (hash) => sessions.get(hash) ?? null,
    },
    now: () => new Date('2026-09-15T10:00:00.000Z'),
  };
  deps.accounts = store;
  const registered = await handleAuthRequest(new Request('https://app.test/api/auth/register', {
    method: 'POST', body: JSON.stringify({ email: 'me@example.com', password: 'correct horse battery staple', displayName: 'Me' }),
  }), deps);
  const cookie = registered.headers.get('Set-Cookie').split(';')[0];
  const me = await handleAuthRequest(new Request('https://app.test/api/auth/me', { headers: { Cookie: cookie } }), deps);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json().then((body) => body.account.displayName), 'Me');
  const logout = await handleAuthRequest(new Request('https://app.test/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } }), deps);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('local HTTP sessions omit Secure only for localhost transport', async () => {
  const deps = { accounts: { findByEmail: async () => null, create: async () => {} }, sessions: { save: async () => {} } };
  const response = await handleAuthRequest(new Request('http://local.test/api/auth/register', {
    method: 'POST', body: JSON.stringify({ email: 'local@example.com', password: 'correct horse battery staple' }),
  }), deps);
  assert.equal(response.status, 201);
  assert.doesNotMatch(response.headers.get('Set-Cookie'), /Secure/);
});

test('QR API authenticates by hashed session and scopes records to the user workspace', async () => {
  const accounts = new Map();
  const sessions = new Map();
  const qrs = new Map();
  const destinations = new Map();
  const workspaceId = 'workspace_a';
  const store = {
    findByEmail: async (email) => accounts.get(email) ?? null,
    create: async (account) => { accounts.set(account.email, account); },
  };
  const qrStore = {
    createQr: async (record) => { qrs.set(record.id, record); },
    getQrInWorkspace: async (workspace, id) => qrs.get(id)?.workspaceId === workspace ? qrs.get(id) : null,
    getQrBySlug: async (slug) => [...qrs.values()].find((qr) => qr.slug === slug) ?? null,
    listQrInWorkspace: async (workspace) => [...qrs.values()].filter((qr) => qr.workspaceId === workspace),
    createDestination: async (destination) => { destinations.set(destination.id, destination); },
    listDestinations: async (qrCodeId) => [...destinations.values()].filter((destination) => destination.qrCodeId === qrCodeId),
  };
  const authDeps = {
    accounts: store, sessions: { save: async (session) => { sessions.set(session.tokenHash, session); } },
    now: () => new Date('2026-09-15T10:00:00.000Z'),
  };
  const login = await handleAuthRequest(new Request('https://app.test/api/auth/register', {
    method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery staple' }),
  }), authDeps);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const deps = {
    sessions: { find: async (tokenHash) => sessions.get(tokenHash) ?? null },
    workspaces: { defaultForUser: async () => ({ id: workspaceId, name: 'Owner workspace' }) },
    qrs: qrStore,
    now: () => new Date('2026-09-15T10:00:00.000Z'),
  };
  const created = await handleQrRequest(new Request('https://app.test/api/qr', {
    method: 'POST', headers: { Cookie: cookie },
    body: JSON.stringify({ id: 'qr_12345', slug: 'summer-2026', kind: 'url', name: 'Summer', destinationUrl: 'https://example.com' }),
  }), deps);
  assert.equal(created.status, 201);
  const listed = await handleQrRequest(new Request('https://app.test/api/qr', { headers: { Cookie: cookie } }), deps);
  assert.equal((await listed.json()).qrCodes.length, 1);
  assert.equal((await handleQrRequest(new Request('https://app.test/api/qr'), deps)).status, 401);
  assert.equal((await handleQrRequest(new Request('https://app.test/api/qr', { method: 'DELETE', headers: { Cookie: cookie } }), deps)).status, 405);
  assert.equal((await handleQrRequest(new Request('https://app.test/api/qr', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ slug: 'bad', kind: 'url', name: 'Bad', destinationUrl: 'javascript:alert(1)' }) }), deps)).status, 400);
});
