import { handleAuthRequest, type AuthApiDependencies } from './auth-api.ts';
import { handleQrRequest, type QrApiDependencies } from './qr-api.ts';
import { handleRedirectRequest } from './redirect-api.ts';

export type AppRouterDependencies = {
  auth: AuthApiDependencies;
  qr: QrApiDependencies;
};

/** Single provider-neutral entry point for future Workers, Node, or VPS adapters. */
export async function handleAppRequest(request: Request, dependencies: AppRouterDependencies): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/auth/')) return handleAuthRequest(request, dependencies.auth);
  if (path === '/api/qr') return handleQrRequest(request, dependencies.qr);
  if (path.startsWith('/r/')) return handleRedirectRequest(request, { qrs: dependencies.qr.qrs, now: dependencies.qr.now });
  return new Response(JSON.stringify({ error: 'notFound' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
