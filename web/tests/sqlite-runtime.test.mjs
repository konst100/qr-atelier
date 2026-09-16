import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalRuntime } from '../server/local-runtime.ts';

test('SQLite runtime persists account, QR cabinet data, and dynamic destination changes', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const register = await runtime.handle(new Request('http://local.test/api/auth/register', {
      method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery staple', displayName: 'Owner' }),
    }));
    assert.equal(register.status, 201);
    const cookie = register.headers.get('Set-Cookie').split(';')[0];

    const me = await runtime.handle(new Request('http://local.test/api/auth/me', { headers: { Cookie: cookie } }));
    assert.equal(me.status, 200);
    assert.equal((await me.json()).account.email, 'owner@example.com');

    const created = await runtime.handle(new Request('http://local.test/api/qr', {
      method: 'POST', headers: { Cookie: cookie },
      body: JSON.stringify({ slug: 'demo-qr', kind: 'url', name: 'Demo QR', destinationUrl: 'https://example.com/first' }),
    }));
    assert.equal(created.status, 201);
    const qr = (await created.json()).qrCode;

    const listed = await runtime.handle(new Request('http://local.test/api/qr', { headers: { Cookie: cookie } }));
    assert.equal((await listed.json()).qrCodes.length, 1);

    const firstRedirect = await runtime.handle(new Request('http://local.test/r/demo-qr', { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone)' } }));
    assert.equal(firstRedirect.status, 302);
    assert.equal(firstRedirect.headers.get('Location'), 'https://example.com/first');

    const updated = await runtime.handle(new Request(`http://local.test/api/qr/${qr.id}`, {
      method: 'PATCH', headers: { Cookie: cookie }, body: JSON.stringify({ destinationUrl: 'https://example.com/second' }),
    }));
    assert.equal(updated.status, 200);
    const secondRedirect = await runtime.handle(new Request('http://local.test/r/demo-qr', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)' } }));
    assert.equal(secondRedirect.status, 302);
    assert.equal(secondRedirect.headers.get('Location'), 'https://example.com/second');
    const stats = await runtime.handle(new Request(`http://local.test/api/qr/${qr.id}/stats`, { headers: { Cookie: cookie } }));
    assert.equal(stats.status, 200);
    assert.equal((await stats.json()).total, 2);
  } finally { runtime.close(); }
});
