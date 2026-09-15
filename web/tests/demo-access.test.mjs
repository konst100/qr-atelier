import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../cloudflare/demo-worker.mjs';

function environment() {
  return {
    DEMO_USER: 'demo', DEMO_PASSWORD: 'test-only-password',
    ASSETS: { fetch: async () => new Response('private site content') },
  };
}

test('unconfigured demo fails closed', async () => {
  const response = await worker.fetch(new Request('https://demo.test/'), {});
  assert.equal(response.status, 503);
});

for (const path of ['/', '/_next/static/app.js', '/index.html', '/index.rsc']) {
  test(`unauthenticated requests cannot reach ${path}`, async () => {
    const env = environment();
    env.ASSETS.fetch = () => assert.fail('Private assets must not be read');
    const response = await worker.fetch(new Request(`https://demo.test${path}`), env);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('WWW-Authenticate'), /^Basic /);
  });
}

for (const authorization of ['Basic !!!', `Basic ${btoa('demo:wrong')}`, 'Bearer anything']) {
  test(`invalid authorization is rejected: ${authorization}`, async () => {
    const response = await worker.fetch(new Request('https://demo.test/', {
      headers: { Authorization: authorization },
    }), environment());
    assert.equal(response.status, 401);
  });
}

test('valid credentials return assets without public caching or indexing', async () => {
  const response = await worker.fetch(new Request('https://demo.test/', {
    headers: { Authorization: `Basic ${btoa('demo:test-only-password')}` },
  }), environment());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'private site content');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
});
