# Protected Cloudflare demo

The demo uses a static Vinext export and a small Cloudflare Worker. No application
server, database, paid plan, or custom domain is required.

## Build and deploy

Run from `web` using Node.js 22.13 or newer:

```powershell
npm ci
npm run check
npm run deploy:demo
```

Configure `DEMO_USER` and `DEMO_PASSWORD` as Cloudflare Worker secrets. Use a
dedicated, randomly generated ASCII password of at least 24 characters. Never
put credentials in Git, client code, a URL, or a public environment variable.

```powershell
npx wrangler secret put DEMO_USER --config wrangler.demo.jsonc
npx wrangler secret put DEMO_PASSWORD --config wrangler.demo.jsonc
```

Every request passes through the Worker (`assets.run_worker_first: true`). Missing
secrets return HTTP 503; incorrect or absent credentials return HTTP 401. Only
authenticated requests reach static assets. Preview URLs are disabled.

Verify the deployed root and a JavaScript asset both return 401 without a
password and 200 with correct credentials. All responses must contain
`Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.

This is a shared-password demo over HTTPS. Browsers may retain Basic Auth
credentials until the browser session ends. Rotate the password to revoke shared
access. This is not individual user accounts or a production authentication
system. Use only demonstration data; saved QR entries stay in that browser.

Only `dist/client` and `cloudflare/demo-worker.mjs` are deployed. Build tooling,
source notes, local credentials, and the Vinext server bundle are not uploaded.
The existing scaffold lint findings and dependency audit require separate cleanup
before a production release.
