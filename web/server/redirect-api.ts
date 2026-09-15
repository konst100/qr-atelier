import { resolveDestination, type QrStore } from './qr-service.ts';

export type RedirectApiDependencies = {
  qrs: QrStore;
  now?: () => Date;
};

function missing(): Response {
  return new Response('QR-код временно недоступен', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/** Resolves a printed QR URL without exposing the database or destination history. */
export async function handleRedirectRequest(request: Request, dependencies: RedirectApiDependencies): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/r\/([^/]+)$/);
  if (!match) return missing();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  let destination: string | null;
  try {
    destination = await resolveDestination(dependencies.qrs, decodeURIComponent(match[1]), dependencies.now?.() ?? new Date());
  } catch {
    destination = null;
  }
  if (!destination) return missing();
  return new Response(null, {
    status: 302,
    headers: {
      Location: destination,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
