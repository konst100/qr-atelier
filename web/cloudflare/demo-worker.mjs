const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

async function sameCredentials(actual, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all(
    [actual, expected].map((value) => crypto.subtle.digest('SHA-256', encoder.encode(value))),
  );
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export default {
  async fetch(request, env) {
    // A fresh deployment stays closed until both secrets are configured.
    if (!env.DEMO_USER || !env.DEMO_PASSWORD) {
      return new Response('Demo access is not configured.', {
        status: 503, headers: privateHeaders,
      });
    }

    let credentials = '';
    const authorization = request.headers.get('Authorization') || '';
    if (/^Basic /i.test(authorization)) {
      try { credentials = atob(authorization.slice(6).trim()); } catch { /* reject malformed input */ }
    }
    if (!await sameCredentials(credentials, `${env.DEMO_USER}:${env.DEMO_PASSWORD}`)) {
      return new Response('Authentication required.', {
        status: 401,
        headers: { ...privateHeaders, 'WWW-Authenticate': 'Basic realm="QR Atelier demo", charset="UTF-8"' },
      });
    }

    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  },
};
