import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalRuntime } from '../server/local-runtime.ts';

async function register(runtime, email = 'cabinet-owner@example.com') {
  const response = await runtime.handle(new Request('http://local.test/api/auth/register', {
    method: 'POST', body: JSON.stringify({ email, password: 'correct horse battery staple', displayName: 'Owner' }),
  }));
  assert.equal(response.status, 201);
  return response.headers.get('Set-Cookie').split(';')[0];
}

function request(cookie, method, value, path = '/api/qr', extraHeaders = {}) {
  return new Request(`http://local.test${path}`, {
    method, headers: { Cookie: cookie, ...extraHeaders },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

const urlQr = (overrides = {}) => ({
  slug: 'cabinet-qr', kind: 'url', name: 'Cabinet QR', destinationUrl: 'https://example.com/first', ...overrides,
});

test('malformed encoded QR paths return not found without crashing the handler', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const response = await runtime.handle(new Request('http://local.test/api/qr/%ZZ'));
    assert.equal(response.status, 404);
  } finally { runtime.close(); }
});

async function records(runtime, cookie) {
  const response = await runtime.handle(request(cookie, 'GET'));
  assert.equal(response.status, 200);
  return (await response.json()).qrCodes;
}

test('cabinet accepts and preserves a 200 KiB center logo on create and edit', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const cookie = await register(runtime);
    const logoDataUrl = `data:image/png;base64,${Buffer.alloc(200 * 1024, 0x42).toString('base64')}`;
    const designJson = JSON.stringify({ logoDataUrl, foreground: '#111827' });
    for (const withLength of [true, false]) {
      const input = urlQr({ slug: `logo-${withLength ? 'length' : 'stream'}`, designJson });
      const headers = withLength ? { 'Content-Length': String(Buffer.byteLength(JSON.stringify(input))) } : {};
      const created = await runtime.handle(request(cookie, 'POST', input, '/api/qr', headers));
      assert.equal(created.status, 201);
      const qr = (await created.json()).qrCode;
      assert.equal(qr.designJson, designJson);
      const nextDesign = JSON.stringify({ logoDataUrl, foreground: '#172554' });
      const edited = await runtime.handle(request(cookie, 'PATCH', { designJson: nextDesign }, `/api/qr/${qr.id}`));
      assert.equal(edited.status, 200);
      assert.equal((await edited.json()).qrCode.designJson, nextDesign);
      assert.equal((await records(runtime, cookie)).find((item) => item.id === qr.id).designJson, nextDesign);
    }
  } finally { runtime.close(); }
});

test('cabinet rejects oversized request bytes with declared, omitted, or understated length', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const cookie = await register(runtime);
    const input = JSON.stringify(urlQr({ designJson: '中'.repeat(101_000) }));
    assert.ok(input.length < 300_000);
    const bytes = new TextEncoder().encode(input);
    assert.ok(bytes.byteLength > 300_000);
    for (const length of [String(bytes.byteLength), undefined, '10']) {
      let offset = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (offset === bytes.byteLength) { controller.close(); return; }
          const next = Math.min(offset + 4096, bytes.byteLength);
          controller.enqueue(bytes.slice(offset, next));
          offset = next;
        },
      });
      const response = await runtime.handle(new Request('http://local.test/api/qr', {
        method: 'POST', headers: { Cookie: cookie, ...(length ? { 'Content-Length': length } : {}) },
        body: stream, duplex: 'half',
      }));
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: 'requestTooLarge' });
    }
    assert.equal((await records(runtime, cookie)).length, 0);
    const created = await runtime.handle(request(cookie, 'POST', urlQr()));
    const qr = (await created.json()).qrCode;
    const edited = await runtime.handle(request(cookie, 'PATCH', { designJson: 'x'.repeat(300_001) }, `/api/qr/${qr.id}`));
    assert.equal(edited.status, 413);
    assert.equal((await records(runtime, cookie))[0].designJson, '{}');
  } finally { runtime.close(); }
});

test('cabinet validates kind, nonempty name, destinations, and slug boundaries before writing', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const cookie = await register(runtime);
    for (const [overrides, error] of [
      [{ kind: 'wifi' }, 'invalidKind'], [{ kind: 'arbitrary' }, 'invalidKind'],
      [{ name: ' \n\t ' }, 'invalidName'], [{ slug: 'a' }, 'invalidSlug'],
      [{ slug: 'short' }, 'invalidSlug'], [{ slug: 'a'.repeat(65) }, 'invalidSlug'],
      [{ destinationUrl: undefined }, 'invalidDestination'], [{ destinationUrl: 'javascript:alert(1)' }, 'invalidDestination'],
      [{ kind: 'text' }, 'invalidDestination'], [{ designJson: [] }, 'invalidRequest'],
    ]) {
      const response = await runtime.handle(request(cookie, 'POST', urlQr(overrides)));
      assert.equal(response.status, 400, JSON.stringify(overrides));
      assert.deepEqual(await response.json(), { error });
    }
    assert.equal((await records(runtime, cookie)).length, 0);
    for (const slug of ['abcdef', 'a'.repeat(64)]) {
      assert.equal((await runtime.handle(request(cookie, 'POST', urlQr({ slug })))).status, 201);
    }
  } finally { runtime.close(); }
});

test('text and contact QR payloads persist without creating redirect destinations', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const cookie = await register(runtime);
    for (const [kind, payload] of [['text', { text: 'A saved note' }], ['contact', { firstName: 'Sample', email: 'contact@example.com' }]]) {
      const designJson = JSON.stringify({ kind, ...payload });
      const created = await runtime.handle(request(cookie, 'POST', { slug: `static-${kind}`, kind, name: kind, designJson }));
      assert.equal(created.status, 201);
      const qr = (await created.json()).qrCode;
      assert.equal(qr.destinationUrl, null);
      assert.equal(qr.designJson, designJson);
      assert.equal((await runtime.client.query('SELECT id FROM qr_destinations WHERE qr_code_id = ?', [qr.id])).length, 0);
      const rejected = await runtime.handle(request(cookie, 'PATCH', { destinationUrl: 'https://example.com' }, `/api/qr/${qr.id}`));
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), { error: 'invalidDestination' });
    }
    assert.equal((await records(runtime, cookie)).length, 2);
  } finally { runtime.close(); }
});

test('duplicate and concurrent slug requests return conflict without replacing the original QR', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const cookie = await register(runtime);
    const responses = await Promise.all([
      runtime.handle(request(cookie, 'POST', urlQr({ name: 'First contender' }))),
      runtime.handle(request(cookie, 'POST', urlQr({ name: 'Second contender' }))),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    assert.deepEqual(await responses.find((response) => response.status === 409).json(), { error: 'slugTaken' });
    const before = await records(runtime, cookie);
    assert.equal(before.length, 1);
    const duplicate = await runtime.handle(request(cookie, 'POST', urlQr({ slug: '  CABINET-QR  ', name: 'Replacement' })));
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await records(runtime, cookie), before);
    assert.equal((await runtime.client.query('SELECT id FROM qr_destinations', [])).length, 1);
  } finally { runtime.close(); }
});

test('authoritative targets survive legacy designs and paused name/design edits avoid extra destination history', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const cookie = await register(runtime);
    let now = new Date();
    runtime.dependencies.qr.now = () => now;
    const created = await runtime.handle(request(cookie, 'POST', urlQr({ destinationUrl: 'https://example.com' })));
    const qr = (await created.json()).qrCode;
    assert.equal(qr.designJson, '{}');
    assert.equal(qr.destinationUrl, 'https://example.com/');
    const path = `/api/qr/${qr.id}`;
    const paused = await runtime.handle(request(cookie, 'PATCH', { status: 'paused' }, path));
    assert.equal((await paused.json()).qrCode.destinationUrl, 'https://example.com/');
    now = new Date(now.getTime() + 1000);
    const edited = await runtime.handle(request(cookie, 'PATCH', { name: 'Renamed', designJson: '{"foreground":"#112233"}', destinationUrl: ' https://example.com ' }, path));
    assert.equal(edited.status, 200);
    const updated = (await edited.json()).qrCode;
    assert.equal(updated.status, 'paused');
    assert.equal(updated.name, 'Renamed');
    assert.equal(updated.destinationUrl, 'https://example.com/');
    assert.equal((await runtime.client.query('SELECT id FROM qr_destinations WHERE qr_code_id = ?', [qr.id])).length, 1);
    const changed = await runtime.handle(request(cookie, 'PATCH', { destinationUrl: 'https://example.com/second' }, path));
    assert.equal((await changed.json()).qrCode.destinationUrl, 'https://example.com/second');
    assert.equal((await records(runtime, cookie))[0].destinationUrl, 'https://example.com/second');
    assert.equal((await runtime.client.query('SELECT id FROM qr_destinations WHERE qr_code_id = ?', [qr.id])).length, 2);
    const invalid = await runtime.handle(request(cookie, 'PATCH', { name: 'Must not save', status: 'active', destinationUrl: 'javascript:alert(1)' }, path));
    assert.equal(invalid.status, 400);
    const persisted = (await records(runtime, cookie))[0];
    assert.equal(persisted.name, 'Renamed');
    assert.equal(persisted.status, 'paused');
    assert.equal(persisted.destinationUrl, 'https://example.com/second');
  } finally { runtime.close(); }
});

test('cabinet isolates workspaces and refuses unauthenticated access or foreign mutations', async () => {
  const runtime = await LocalRuntime.open();
  try {
    const owner = await register(runtime);
    const other = await register(runtime, 'other-owner@example.com');
    const created = await runtime.handle(request(owner, 'POST', urlQr()));
    const qr = (await created.json()).qrCode;
    assert.equal((await runtime.handle(new Request('http://local.test/api/qr'))).status, 401);
    assert.deepEqual(await records(runtime, other), []);
    for (const [method, value] of [['PATCH', { name: 'Not yours' }], ['DELETE', undefined]]) {
      const response = await runtime.handle(request(other, method, value, `/api/qr/${qr.id}`));
      assert.equal(response.status, 404);
    }
    const persisted = (await records(runtime, owner))[0];
    assert.equal(persisted.name, qr.name);
    assert.equal(persisted.status, 'active');
  } finally { runtime.close(); }
});
