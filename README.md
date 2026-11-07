# DM Motor Group — International Automobile Dealership Platform

Production, real-data platform for an international car dealership:

- **Public showroom website** — home (featured/latest/category rails/banners/videos/testimonials), showroom with full filtering (manufacturer, model, price, year, mileage, transmission, fuel, body type, location), rich vehicle detail pages with photo gallery + full-length video, video showcase, compare, contact/enquiries, customer accounts, favourites.
- **Admin dashboard** (`/admin`) — full inventory CRUD + publish/unpublish/draft/reserved/sold lifecycle, photo & full-length video uploads (streamed), cover/thumbnail/reorder management, enquiry pipeline (8 types, status workflow, staff replies), customers & staff roles, testimonials approval, homepage banners, settings, activity log.
- **Android app (PWA)** — installable on Android, service worker caching, full-screen mode.

## Production architecture (the real one)

```
        ┌────────────────────────────────────────────┐
        │ Cloudflare Pages  (dm-motor-group)         │
        │  · static assets (public/, admin/)         │
        │  · Worker  dist/_worker.js                 │
        │      · /api/*      → /api dispatcher        │
        │      · /api/vehicles/:slug, /sitemap.xml   │
        │      · everything else → SPA/Admin shell   │
        └──────────────────────┬─────────────────────┘
                               │ HTTPS (server-only secrets)
        ┌──────────────────────▼─────────────────────┐
        │ Supabase  (project "Cars", eu-central-1)   │
        │  · Postgres 12 tables + RLS policies        │
        │  · auth schema (GoTrue) + profiles table   │
        │  · Storage buckets: vehicle-media (2GB), banners
        │  · RPC helpers: admin_counts, home_stats, …│
        └────────────────────────────────────────────┘
```

- Frontend never holds server secrets. The Worker holds `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_KEY`, `SITE_URL` (Pages secrets). The service key exists **only** in the Worker
  environment; all DB writes go through it, enforcing server-side validation.
- The REST contract was preserved from the original Node backend (camelCase API responses), so the
  existing `public/app.js` and `admin/admin.js` frontends work unchanged against the new backend.

## Quick start (local development)

```
npm install
node build.mjs          # esbuild-bundles shared/_worker.js → dist/_worker.js
npx wrangler pages dev  # local dev with the Worker + real Supabase
node scripts/fetch-supabase-env.mjs   # writes .env.local / .dev.vars from the Supabase Management API
node scripts/configure-auth.mjs       # sets production auth site_url via Management API
node scripts/run-migrations.mjs      # applies supabase/migrations/*.sql via Management API
node scripts/verify-db.mjs          # verifies tables/policies/buckets/functions
```

## Deploying to production (repeatable)

```
node build.mjs
npx wrangler pages deploy dist --project-name dm-motor-group --branch main
npx wrangler pages secret put SUPABASE_URL        # from .env.local
npx wrangler pages secret put SUPABASE_ANON_KEY
npx wrangler pages secret put SUPABASE_SERVICE_KEY
npx wrangler pages secret put SITE_URL
```

- The Cloudflare account is tied to the owner (e.g. `weverseonlineshop@gmail.com`).
- Custom domain `dmmotorgroup.com` (+ `www`) must be attached to the Pages project — in the Cloudflare
  dashboard: **Pages → dm-motor-group → Custom domains → Add dmmotorgroup.com** (2-click step, since
  wrangler OAuth lacks that scope; DNS/CNAME will be created automatically by Cloudflare).

### Auto-deploy (recommended)

Connect GitHub: **Cloudflare Dashboard → Workers & Pages → dm-motor-group → Settings → Git → Connect to Git**,
repository `odenyizabeya-lab/DM-motor-group`, branch `main`. Every push to `main` auto-builds + deploys.

## Setup checklist for the owner

1. Register the very first account on the platform — it automatically becomes the `admin` (owner
   bootstrap, via `handle_new_user` trigger).
2. Add dealership details in Admin → Settings (name, phones, WhatsApp, address, socials, currency).
3. Add real vehicles through Admin → Vehicles with real photos/videos uploaded via the media manager.
   Publish them (draft → published → reserved → sold).
4. Add approved testimonials (they only go public after admin approval).
5. Submit an enquiry from the public site, respond in Admin → Enquiries (auto-notification to the customer).
6. Track reservations/orders (status pipeline new → deposit_paid → in_progress → completed / cancelled);
   completing an order flips the vehicle to `sold`.

## No demo data

The platform starts with an **empty** database. No demo vehicles, banners, testimonials or logs are
seeded. Everything published lives in the owner's Supabase project. Local-only legacy code
(`server.js`, `seed.js`, `lib/`, `data/`, `uploads/`) is no longer part of the production build.

## Tests

```
node test/smoke.mjs     # end-to-end smoke suite against the deployed backend (currently green on prod)
node scripts/verify-db.mjs        # Supabase DB state via Management API
```

## Security notes

- No passwords, service-role keys or API secrets in frontend code. Worker-only secrets.
- RLS enabled on all tables; server writes go through service-role.
- Public write endpoints guarded (rate limits, honeypot, duplicate guards, server-side validation).
- `test/e2e.js`, old Node backend, seeder: legacy/local — not deployed.
