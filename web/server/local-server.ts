import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalRuntime } from './local-runtime.ts';

const root = dirname(fileURLToPath(import.meta.url));
const assetsRoot = join(root, '..', 'dist', 'client');
const port = Number(process.env.QR_ATELIER_PORT ?? 3010);
const databaseFile = process.env.QR_ATELIER_DB ?? join(root, '..', '.local', 'qr-atelier.sqlite');

function headers(request: IncomingMessage): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) result.set(name, value.join(', '));
    else if (value) result.set(name, value);
  }
  return result;
}

async function requestBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_048_576) throw new Error('requestTooLarge');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function contentType(path: string): string {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream';
}

async function serveAsset(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = normalize(join(assetsRoot, relative));
  if (!candidate.startsWith(normalize(assetsRoot))) { response.writeHead(400); response.end('Bad path'); return; }
  let file = candidate;
  try { await readFile(file); } catch { file = join(assetsRoot, '404.html'); }
  try {
    const data = await readFile(file);
    response.writeHead(file.endsWith('404.html') ? 404 : 200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end(); else response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
}

async function main(): Promise<void> {
  await mkdir(dirname(databaseFile), { recursive: true });
  const runtime = await LocalRuntime.open(databaseFile);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/r/')) {
        const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await requestBody(request);
        const init: RequestInit = { method: request.method, headers: headers(request) };
        if (body) init.body = body as BodyInit;
        const result = await runtime.handle(new Request(url, init));
        response.statusCode = result.status;
        result.headers.forEach((value, key) => response.setHeader(key, value));
        response.end(request.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
        return;
      }
      await serveAsset(request, response, url.pathname);
    } catch (error) {
      const status = error instanceof Error && error.message === 'requestTooLarge' ? 413 : 500;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: status === 413 ? 'requestTooLarge' : 'serverError' }));
    }
  });
  const close = () => { runtime.close(); server.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  server.listen(port, '127.0.0.1', () => console.log(`QR Atelier local runtime: http://127.0.0.1:${port}`));
}

void main();
