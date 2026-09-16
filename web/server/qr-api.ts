import { hashSessionToken, type SessionData } from '../lib/account.ts';
import { addDestination, createQr, currentQrDestination, validateDestination, type QrRecord, type QrStore } from './qr-service.ts';

export type SessionLookup = {
  find(tokenHash: string): Promise<SessionData | null>;
};

export type WorkspaceAccess = {
  defaultForUser(userId: string): Promise<{ id: string; name: string } | null>;
};

export type QrApiDependencies = {
  sessions: SessionLookup;
  workspaces: WorkspaceAccess;
  qrs: QrStore;
  now?: () => Date;
};

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...headers } });
}

function sessionCookie(request: Request): string | null {
  const cookies = request.headers.get('Cookie')?.split(';') ?? [];
  const item = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('qr_session='));
  if (!item) return null;
  const value = item.slice('qr_session='.length);
  try { return decodeURIComponent(value); } catch { return null; }
}

async function currentUser(request: Request, dependencies: QrApiDependencies, now: Date): Promise<{ id: string } | null> {
  const token = sessionCookie(request);
  if (!token) return null;
  const session = await dependencies.sessions.find(await hashSessionToken(token));
  if (!session || Date.parse(session.expiresAt) <= now.getTime()) return null;
  return { id: session.userId };
}

type BodyResult = { input: Record<string, unknown>; error?: never } | { input?: never; error: 'invalidRequest' | 'requestTooLarge' };
const maxBodyBytes = 300_000;

async function body(request: Request): Promise<BodyResult> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isSafeInteger(length) || length < 0) return { error: 'invalidRequest' };
  if (length > maxBodyBytes) return { error: 'requestTooLarge' };
  if (!request.body) return { error: 'invalidRequest' };
  const reader = request.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        return { error: 'requestTooLarge' };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { input: value as Record<string, unknown> } : { error: 'invalidRequest' };
  } catch { return { error: 'invalidRequest' }; }
  finally { reader.releaseLock(); }
}

async function responseRecord(qr: QrRecord, store: QrStore, now: Date) {
  const destinationUrl = qr.kind === 'url' ? (await currentQrDestination(store, qr.id, now))?.destinationUrl ?? null : null;
  return {
    id: qr.id, workspaceId: qr.workspaceId, slug: qr.slug, kind: qr.kind,
    name: qr.name, status: qr.status, designJson: qr.designJson,
    folderId: qr.folderId, campaignId: qr.campaignId, expiresAt: qr.expiresAt,
    createdAt: qr.createdAt, updatedAt: qr.updatedAt, destinationUrl,
  };
}

const statuses = new Set(['active', 'paused', 'expired', 'archived']);

function qrId(url: URL): string | null {
  const match = url.pathname.match(/^\/api\/qr\/([^/]+)$/);
  try { return match ? decodeURIComponent(match[1]) : null; }
  catch { return null; }
}

export async function handleQrRequest(request: Request, dependencies: QrApiDependencies): Promise<Response> {
  const url = new URL(request.url);
  const id = qrId(url);
  if (url.pathname !== '/api/qr' && !id) return json({ error: 'notFound' }, 404);
  const now = dependencies.now?.() ?? new Date();
  const user = await currentUser(request, dependencies, now);
  if (!user) return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
  const workspace = await dependencies.workspaces.defaultForUser(user.id);
  if (!workspace) return json({ error: 'workspaceNotFound' }, 403);

  if (id) {
    const existing = await dependencies.qrs.getQrInWorkspace(workspace.id, id);
    if (!existing) return json({ error: 'notFound' }, 404);
    if (request.method === 'DELETE') {
      const archived = { ...existing, status: 'archived' as const, updatedAt: now.toISOString() };
      await dependencies.qrs.updateQr(archived);
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'PATCH') return json({ error: 'methodNotAllowed' }, 405, { Allow: 'PATCH, DELETE' });
    const parsed = await body(request);
    if (parsed.error) return json({ error: parsed.error }, parsed.error === 'requestTooLarge' ? 413 : 400);
    const input = parsed.input;
    if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim())) return json({ error: 'invalidName' }, 400);
    if (input.designJson !== undefined && typeof input.designJson !== 'string') return json({ error: 'invalidRequest' }, 400);
    if (input.expiresAt !== undefined && input.expiresAt !== null && (typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt)))) return json({ error: 'invalidDates' }, 400);
    const nextStatus = input.status === undefined ? existing.status : input.status;
    if (typeof nextStatus !== 'string' || !statuses.has(nextStatus)) return json({ error: 'invalidStatus' }, 400);
    const updated: QrRecord = {
      ...existing,
      name: input.name === undefined ? existing.name : typeof input.name === 'string' ? input.name.trim().slice(0, 120) : existing.name,
      status: nextStatus as QrRecord['status'],
      designJson: input.designJson === undefined ? existing.designJson : typeof input.designJson === 'string' ? input.designJson : existing.designJson,
      expiresAt: input.expiresAt === null ? null : input.expiresAt === undefined ? existing.expiresAt : typeof input.expiresAt === 'string' ? input.expiresAt : existing.expiresAt,
      updatedAt: now.toISOString(),
    };
    if (!updated.name) return json({ error: 'invalidName' }, 400);
    if (input.destinationUrl !== undefined) {
      if (existing.kind !== 'url' || typeof input.destinationUrl !== 'string') return json({ error: 'invalidDestination' }, 400);
      try { validateDestination(input.destinationUrl); } catch { return json({ error: 'invalidDestination' }, 400); }
    }
    await dependencies.qrs.updateQr(updated);
    if (typeof input.destinationUrl === 'string') {
      const destinationUrl = validateDestination(input.destinationUrl);
      const current = await currentQrDestination(dependencies.qrs, existing.id, now);
      if (current?.destinationUrl !== destinationUrl) {
        await addDestination(dependencies.qrs, workspace.id, { qrCodeId: existing.id, destinationUrl }, now);
      }
    }
    return json({ qrCode: await responseRecord(updated, dependencies.qrs, now) }, 200);
  }

  if (request.method === 'GET') {
    const records = await dependencies.qrs.listQrInWorkspace(workspace.id);
    const qrCodes = await Promise.all(records.filter((record) => record.status !== 'archived').map((record) => responseRecord(record, dependencies.qrs, now)));
    return json({ workspace, qrCodes }, 200);
  }
  if (request.method !== 'POST') return json({ error: 'methodNotAllowed' }, 405, { Allow: 'GET, POST' });
  const parsed = await body(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.error === 'requestTooLarge' ? 413 : 400);
  const input = parsed.input;
  if (typeof input.slug !== 'string' || typeof input.kind !== 'string' || typeof input.name !== 'string') {
    return json({ error: 'invalidRequest' }, 400);
  }
  if (!['url', 'text', 'contact'].includes(input.kind)) return json({ error: 'invalidKind' }, 400);
  if (!input.name.trim()) return json({ error: 'invalidName' }, 400);
  if (input.designJson !== undefined && typeof input.designJson !== 'string') return json({ error: 'invalidRequest' }, 400);
  try {
    // URL records need a destination; text/contact records keep their payload in designJson.
    if (input.kind === 'url' ? typeof input.destinationUrl !== 'string' : input.destinationUrl !== undefined) return json({ error: 'invalidDestination' }, 400);
    const destinationUrl = typeof input.destinationUrl === 'string' ? validateDestination(input.destinationUrl) : null;
    const qr = await createQr(dependencies.qrs, {
      workspaceId: workspace.id,
      id: typeof input.id === 'string' ? input.id : undefined,
      slug: input.slug,
      kind: input.kind,
      name: input.name,
      designJson: typeof input.designJson === 'string' ? input.designJson : undefined,
    }, now);
    if (destinationUrl !== null) {
      await addDestination(dependencies.qrs, workspace.id, { qrCodeId: qr.id, destinationUrl }, now);
    }
    return json({ qrCode: await responseRecord(qr, dependencies.qrs, now) }, 201);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'slugTaken') return json({ error: code }, 409);
    if (code === 'invalidSlug' || code === 'invalidDestination' || code === 'invalidDates' || code === 'invalidKind' || code === 'invalidName') return json({ error: code }, 400);
    return json({ error: 'serverError' }, 500);
  }
}
