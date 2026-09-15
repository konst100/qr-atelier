import { resolveQrTarget, type QrStore } from './qr-service.ts';
import { recordScan, type ScanStore } from './scan-service.ts';

export type RedirectApiDependencies = {
  qrs: QrStore;
  scans?: ScanStore;
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
  let target: Awaited<ReturnType<typeof resolveQrTarget>>;
  try {
    const now = dependencies.now?.() ?? new Date();
    target = await resolveQrTarget(dependencies.qrs, decodeURIComponent(match[1]), now);
    if (target) await recordScan(dependencies.scans, target.qr.id, request, now);
  } catch {
    target = null;
  }
  if (!target) return missing();
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.destination.destinationUrl,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
