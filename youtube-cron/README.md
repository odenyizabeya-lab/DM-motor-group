# YouTube Automation cron — 2-minute setup (free)

The site decides *when* to publish; this tiny Worker just nudges it every 30
minutes. It needs **one** secret — the same internal key your site already
uses for `/api/internal/ai/tick` (Admin → Integrations → internal key, or a
Pages secret named `AI_INTERNAL_KEY`). No Google credentials live here.

## Option A — command line (recommended)

```powershell
cd youtube-cron
npx wrangler login        # only if your Cloudflare session expired
npx wrangler deploy       # deploys dm-youtube-cron with the 30-minute trigger
npx wrangler secret put INTERNAL_KEY   # paste the same internal key your site uses
```

## Option B — Cloudflare dashboard (no command line)

1. Cloudflare dashboard → Workers & Pages → Create → Worker → name it `dm-youtube-cron`.
2. Open it → Edit code → paste the whole contents of `cron.js` → Save & deploy.
3. Settings → Variables → Add variable: `INTERNAL_KEY` (Secret) = the internal
   key your site already uses for its internal tick endpoint.
4. Settings → Triggers → Cron Triggers → Add trigger → `*/30 * * * *` → Save.

## What to check after deployment

- Workers → dm-youtube-cron → Logs: you should see `tick 200 {"ok":true,"skipped":"disabled"}`
  until you enable Automation in Admin → YouTube Automation.
- Once enabled and the publishing time arrives: `{"ok":true,"published":true,...}`.
