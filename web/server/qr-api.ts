import { hashSessionToken, type SessionData } from '../lib/account.ts';
import { addDestination, createQr, validateDestination, type QrRecord, type QrStore } from './qr-service.ts';

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

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 16_384) return null;
  try {
    const value: unknown = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function responseRecord(qr: QrRecord) {
  return {
    id: qr.id, workspaceId: qr.workspaceId, slug: qr.slug, kind: qr.kind,
    name: qr.name, status: qr.status, designJson: qr.designJson,
    folderId: qr.folderId, campaignId: qr.campaignId, expiresAt: qr.expiresAt,
    createdAt: qr.createdAt, updatedAt: qr.updatedAt,
  };
}

export async function handleQrRequest(request: Request, dependencies: QrApiDependencies): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/qr') return json({ error: 'notFound' }, 404);
  const now = dependencies.now?.() ?? new Date();
  const user = await currentUser(request, dependencies, now);
  if (!user) return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
  const workspace = await dependencies.workspaces.defaultForUser(user.id);
  if (!workspace) return json({ error: 'workspaceNotFound' }, 403);

  if (request.method === 'GET') {
    const records = await dependencies.qrs.listQrInWorkspace(workspace.id);
    return json({ workspace, qrCodes: records.map(responseRecord) }, 200);
  }
  if (request.method !== 'POST') return json({ error: 'methodNotAllowed' }, 405, { Allow: 'GET, POST' });
  const input = await body(request);
  if (!input || typeof input.slug !== 'string' || typeof input.kind !== 'string' || typeof input.name !== 'string' || typeof input.destinationUrl !== 'string') {
    return json({ error: 'invalidRequest' }, 400);
  }
  try {
    // Validate before the first INSERT so malformed input cannot leave an orphan QR row.
    validateDestination(input.destinationUrl);
    const qr = await createQr(dependencies.qrs, {
      workspaceId: workspace.id,
      id: typeof input.id === 'string' ? input.id : undefined,
      slug: input.slug,
      kind: input.kind,
      name: input.name,
      designJson: typeof input.designJson === 'string' ? input.designJson : undefined,
    }, now);
    await addDestination(dependencies.qrs, workspace.id, {
      qrCodeId: qr.id,
      destinationUrl: input.destinationUrl,
    }, now);
    return json({ qrCode: responseRecord(qr) }, 201);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'invalidSlug' || code === 'invalidDestination' || code === 'invalidDates') return json({ error: code }, 400);
    return json({ error: 'serverError' }, 500);
  }
}
