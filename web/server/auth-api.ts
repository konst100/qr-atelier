import {
  createSession,
  type SessionData,
  type RegistrationInput,
} from '../lib/account.ts';
import {
  AccountServiceError,
  authenticateAccount,
  registerAccount,
  type AccountStore,
} from './account-service.ts';

export type SessionStore = {
  save(session: SessionData): Promise<void>;
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

function cookie(token: string): string {
  return `qr_session=${encodeURIComponent(token)}; Max-Age=${sessionLifetimeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function handleAuthRequest(request: Request, dependencies: AuthApiDependencies): Promise<Response> {
  const url = new URL(request.url);
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
    return json({ account }, url.pathname.endsWith('/register') ? 201 : 200, { 'Set-Cookie': cookie(session.token) });
  } catch (error) {
    if (error instanceof AccountServiceError) {
      if (error.code === 'emailTaken') return json({ error: error.code }, 409);
      if (error.code === 'invalidCredentials') return json({ error: error.code }, 401);
      return json({ error: error.code }, 400);
    }
    return json({ error: 'serverError' }, 500);
  }
}
