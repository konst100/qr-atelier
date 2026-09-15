import {
  createSession,
  hashSessionToken,
  type SessionData,
  type RegistrationInput,
} from '../lib/account.ts';
import {
  AccountServiceError,
  authenticateAccount,
  registerAccount,
  type PublicAccount,
  type AccountStore,
} from './account-service.ts';

export type SessionStore = {
  save(session: SessionData): Promise<void>;
  find?(tokenHash: string): Promise<SessionData | null>;
};

export type AuthApiDependencies = {
  accounts: AccountStore;
  sessions: SessionStore;
  now?: () => Date;
};

const sessionLifetimeSeconds = 60 * 60 * 24 * 30;
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...headers } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 16_384) return null;
  try {
    const value: unknown = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function registrationInput(body: Record<string, unknown>): RegistrationInput | null {
  if (typeof body.email !== 'string' || typeof body.password !== 'string') return null;
  return {
    email: body.email,
    password: body.password,
    displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
  };
}

function cookie(token: string, secure: boolean): string {
  return `qr_session=${encodeURIComponent(token)}; Max-Age=${sessionLifetimeSeconds}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax`;
}

function clearedCookie(secure: boolean): string {
  return `qr_session=; Max-Age=0; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax`;
}

async function sessionUser(request: Request, dependencies: AuthApiDependencies): Promise<PublicAccount | null> {
  const raw = request.headers.get('Cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith('qr_session='));
  if (!raw || !dependencies.accounts.findById) return null;
  let token: string;
  try { token = decodeURIComponent(raw.slice('qr_session='.length)); } catch { return null; }
  const session = await dependencies.sessions.find?.(await hashSessionToken(token));
  if (!session || Date.parse(session.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) return null;
  const account = await dependencies.accounts.findById(session.userId);
  if (!account) return null;
  const { password: _password, ...safe } = account;
  return safe;
}

export async function handleAuthRequest(request: Request, dependencies: AuthApiDependencies): Promise<Response> {
  const url = new URL(request.url);
  const secureCookie = url.protocol === 'https:';
  if (url.pathname === '/api/auth/logout') {
    if (request.method !== 'POST') return json({ error: 'methodNotAllowed' }, 405, { Allow: 'POST' });
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearedCookie(secureCookie) } });
  }
  if (url.pathname === '/api/auth/me') {
    if (request.method !== 'GET') return json({ error: 'methodNotAllowed' }, 405, { Allow: 'GET' });
    return json({ account: await sessionUser(request, dependencies) }, 200);
  }
  if (url.pathname !== '/api/auth/register' && url.pathname !== '/api/auth/login') {
    return json({ error: 'notFound' }, 404);
  }
  if (request.method !== 'POST') {
    return json({ error: 'methodNotAllowed' }, 405, { Allow: 'POST' });
  }
  const body = await readBody(request);
  const input = body ? registrationInput(body) : null;
  if (!input) return json({ error: 'invalidRequest' }, 400);
  const now = dependencies.now?.() ?? new Date();
  try {
    const account = url.pathname.endsWith('/register')
      ? await registerAccount(dependencies.accounts, input, { now })
      : await authenticateAccount(dependencies.accounts, input.email, input.password);
    const session = await createSession(account.id, sessionLifetimeSeconds * 1000);
    await dependencies.sessions.save(session.data);
    return json({ account }, url.pathname.endsWith('/register') ? 201 : 200, { 'Set-Cookie': cookie(session.token, secureCookie) });
  } catch (error) {
    if (error instanceof AccountServiceError) {
      if (error.code === 'emailTaken') return json({ error: error.code }, 409);
      if (error.code === 'invalidCredentials') return json({ error: error.code }, 401);
      return json({ error: error.code }, 400);
    }
    return json({ error: 'serverError' }, 500);
  }
}
