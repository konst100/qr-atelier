import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { LocalRuntime } from '../server/local-runtime.ts';

const origin = 'http://local.test';
const initialTime = '2026-09-15T10:00:00.000Z';

function clock(runtime, iso) {
  const now = () => new Date(iso);
  runtime.dependencies.auth.now = now;
  runtime.dependencies.qr.now = now;
  runtime.dependencies.stats.now = now;
}

async function register(runtime, email = 'owner@example.com') {
  const response = await runtime.handle(new Request(`${origin}/api/auth/register`, {
    method: 'POST', body: JSON.stringify({ email, password: 'test-only strong passphrase', displayName: 'Test owner' }),
  }));
  assert.equal(response.status, 201);
  return response.headers.get('Set-Cookie').split(';')[0];
}

async function fixture(filename) {
  const runtime = await LocalRuntime.open(filename);
  clock(runtime, initialTime);
  const cookie = await register(runtime);
  const response = await runtime.handle(new Request(`${origin}/api/qr`, {
    method: 'POST', headers: { Cookie: cookie },
    body: JSON.stringify({ slug: 'scan-demo', kind: 'url', name: 'Scan demo', destinationUrl: 'https://example.com/destination' }),
  }));
  assert.equal(response.status, 201);
  return { runtime, cookie, qr: (await response.json()).qrCode };
}

function stats(f, query = '', cookie = f.cookie) {
  return f.runtime.handle(new Request(`${origin}/api/qr/${f.qr.id}/stats${query}`, { headers: cookie ? { Cookie: cookie } : {} }));
}

function redirect(runtime, method = 'GET', userAgent = 'Mozilla/5.0 (Windows NT 10.0)') {
  return runtime.handle(new Request(`${origin}/r/scan-demo`, { method, headers: { 'User-Agent': userAgent } }));
}

test('real runtime counts only successful GET redirects and separates UTC days and devices', async () => {
  const f = await fixture();
  try {
    assert.equal((await redirect(f.runtime, 'GET', 'Mozilla/5.0 (iPhone)')).status, 302);
    assert.equal((await redirect(f.runtime, 'GET')).status, 302);
    const head = await redirect(f.runtime, 'HEAD');
    assert.equal(head.status, 302);
    assert.equal(head.headers.get('Location'), 'https://example.com/destination');
    assert.equal(await head.text(), '');
    assert.equal((await redirect(f.runtime, 'POST')).status, 405);
    assert.equal((await f.runtime.handle(new Request(`${origin}/r/missing-code`))).status, 404);
    // 00:30 in Berlin is still the previous UTC day.
    clock(f.runtime, '2026-09-16T00:30:00+02:00');
    assert.equal((await redirect(f.runtime, 'GET', 'Android Mobile')).status, 302);
    clock(f.runtime, '2026-09-16T00:30:00Z');
    assert.equal((await redirect(f.runtime, 'GET')).status, 302);
    for (const status of ['paused', 'archived']) {
      await f.runtime.client.query('UPDATE qr_codes SET status = ? WHERE id = ?', [status, f.qr.id]);
      assert.equal((await redirect(f.runtime)).status, 404);
    }
    const response = await stats(f, '?from=2026-09-15&to=2026-09-16');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {
      qrCodeId: f.qr.id, from: '2026-09-15', to: '2026-09-16', total: 4,
      daily: [
        { day: '2026-09-15', scans: 3, deviceMobile: 2, deviceDesktop: 1 },
        { day: '2026-09-16', scans: 1, deviceMobile: 0, deviceDesktop: 1 },
      ],
    });
  } finally { f.runtime.close(); }
});

test('parallel GET requests preserve every scan on both a new and an existing daily row', async () => {
  const f = await fixture();
  try {
    for (let batch = 0; batch < 2; batch += 1) {
      const responses = await Promise.all(Array.from({ length: 120 }, (_, index) =>
        redirect(f.runtime, 'GET', index % 2 ? 'Android Mobile' : 'Desktop')));
      assert.ok(responses.every((response) => response.status === 302));
      assert.equal((await (await stats(f)).json()).total, (batch + 1) * 120);
    }
    assert.deepEqual((await (await stats(f)).json()).daily, [
      { day: '2026-09-15', scans: 240, deviceMobile: 120, deviceDesktop: 120 },
    ]);
  } finally { f.runtime.close(); }
});

test('failed scan persistence leaves redirects working and unavailable stats return a safe response', async () => {
  const f = await fixture();
  try {
    f.runtime.dependencies.stats.scans = {
      record: async () => { throw new Error('private database connection detail'); },
      listDaily: async () => { throw new Error('private database connection detail'); },
    };
    const response = await redirect(f.runtime);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), 'https://example.com/destination');
    const unavailable = await stats(f);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { error: 'serviceUnavailable' });
  } finally { f.runtime.close(); }
});

test('statistics require an unexpired session and QR ownership in the current workspace', async () => {
  const f = await fixture();
  try {
    await redirect(f.runtime);
    const otherCookie = await register(f.runtime, 'other-owner@example.com');
    const other = await stats(f, '', otherCookie);
    assert.equal(other.status, 404);
    assert.deepEqual(await other.json(), { error: 'notFound' });
    assert.equal((await stats(f, '', '')).status, 401);
    assert.equal((await stats(f, '', 'qr_session=not-a-valid-session')).status, 401);
    assert.equal((await stats(f)).status, 200);
    clock(f.runtime, '2027-09-15T10:00:00.000Z');
    assert.equal((await stats(f)).status, 401);
  } finally { f.runtime.close(); }
});

test('statistics use inclusive calendar dates, reject overflows, and default to 30 UTC days', async () => {
  const f = await fixture();
  try {
    for (const day of ['2026-08-16', '2026-08-17', '2026-08-18', '2026-09-15', '2026-09-16']) {
      await f.runtime.dependencies.stats.scans.record({ qrCodeId: f.qr.id, day, device: 'desktop' });
    }
    const defaults = await (await stats(f)).json();
    assert.equal(defaults.from, '2026-08-17');
    assert.equal(defaults.to, '2026-09-15');
    assert.equal(defaults.total, 3);
    assert.deepEqual(defaults.daily.map((row) => row.day), ['2026-08-17', '2026-08-18', '2026-09-15']);
    const oneDay = await (await stats(f, '?from=2026-08-18&to=2026-08-18')).json();
    assert.equal(oneDay.total, 1);
    assert.deepEqual(oneDay.daily.map((row) => row.day), ['2026-08-18']);
    for (const query of [
      '?from=2026-02-30&to=2026-03-01', '?from=2026-02-29&to=2026-03-01',
      '?from=2026-09-16&to=2026-09-15', '?from=2026-13-01', '?to=2026-09-00',
      '?from=2026-9-01', '?from=', '?to=bad',
    ]) {
      const response = await stats(f, query);
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: 'invalidRange' });
    }
    const leapDay = await stats(f, '?from=2024-02-29&to=2024-02-29');
    assert.equal(leapDay.status, 200);
    assert.deepEqual((await leapDay.json()).daily, []);
  } finally { f.runtime.close(); }
});

test('independent SQLite writers atomically increment the same daily row', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qr-scan-test-'));
  const filename = join(directory, 'scans.sqlite');
  const workers = [];
  let f;
  try {
    f = await fixture(filename);
    const workerSource = `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { SqliteClient } = await import(workerData.clientUrl);
        const { SqlScanStore } = await import(workerData.storeUrl);
        const client = new SqliteClient(workerData.filename);
        await client.query('PRAGMA busy_timeout = 10000', []);
        const store = new SqlScanStore(client);
        parentPort.postMessage('ready');
        parentPort.once('message', async () => {
          try {
            for (let index = 0; index < 100; index += 1) {
              await store.record({ qrCodeId: workerData.qrId, day: '2026-09-15', device: workerData.device });
            }
            client.close();
            parentPort.postMessage('done');
          } catch (error) { client.close(); throw error; }
        });
      })();
    `;
    const ready = [];
    const finished = [];
    for (let index = 0; index < 4; index += 1) {
      const worker = new Worker(workerSource, {
        eval: true,
        workerData: {
          filename, qrId: f.qr.id, device: index % 2 ? 'mobile' : 'desktop',
          clientUrl: new URL('../server/sqlite-client.ts', import.meta.url).href,
          storeUrl: new URL('../server/sql-store.ts', import.meta.url).href,
        },
      });
      workers.push(worker);
      ready.push(new Promise((resolve, reject) => {
        worker.on('message', (message) => { if (message === 'ready') resolve(); });
        worker.once('error', reject);
      }));
      finished.push(new Promise((resolve, reject) => {
        worker.once('error', reject);
        worker.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Writer exited ${code}`)));
      }));
    }
    await Promise.all(ready);
    const completion = Promise.all(finished);
    workers.forEach((worker) => worker.postMessage('start'));
    await completion;
    const result = await (await stats(f)).json();
    assert.equal(result.total, 400);
    assert.deepEqual(result.daily, [{ day: '2026-09-15', scans: 400, deviceMobile: 200, deviceDesktop: 200 }]);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    f?.runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
