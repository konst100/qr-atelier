import { hashSessionToken, type SessionData } from '../lib/account.ts';
import type { QrStore } from './qr-service.ts';
import type { ScanStore } from './scan-service.ts';

export type StatsApiDependencies = {
  sessions: { find(tokenHash: string): Promise<SessionData | null> };
  workspaces: { defaultForUser(userId: string): Promise<{ id: string; name: string } | null> };
  qrs: QrStore;
  scans: ScanStore;
  now?: () => Date;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function cookie(request: Request): string | null {
  const item = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith('qr_session='));
  if (!item) return null;
  try { return decodeURIComponent(item.slice('qr_session='.length)); } catch { return null; }
}

async function user(request: Request, dependencies: StatsApiDependencies, now: Date): Promise<string | null> {
  const token = cookie(request);
  if (!token) return null;
  const session = await dependencies.sessions.find(await hashSessionToken(token));
  return session && Date.parse(session.expiresAt) > now.getTime() ? session.userId : null;
}

function validDay(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

export async function handleStatsRequest(request: Request, dependencies: StatsApiDependencies): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'methodNotAllowed' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/qr\/([^/]+)\/stats$/);
  if (!match) return json({ error: 'notFound' }, 404);
  let qrId: string;
  try { qrId = decodeURIComponent(match[1]); } catch { return json({ error: 'notFound' }, 404); }
  const now = dependencies.now?.() ?? new Date();
  const userId = await user(request, dependencies, now);
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const workspace = await dependencies.workspaces.defaultForUser(userId);
  if (!workspace || !(await dependencies.qrs.getQrInWorkspace(workspace.id, qrId))) return json({ error: 'notFound' }, 404);
  const defaultFrom = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? defaultFrom;
  const to = url.searchParams.get('to') ?? now.toISOString().slice(0, 10);
  if (!validDay(from) || !validDay(to) || from > to) return json({ error: 'invalidRange' }, 400);
  const daily = await dependencies.scans.listDaily(qrId, from, to);
  return json({ qrCodeId: qrId, from, to, total: daily.reduce((sum, item) => sum + item.scans, 0), daily }, 200);
}
