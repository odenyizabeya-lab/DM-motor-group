# DM Motor Group — Dealership Platform

A complete, self-contained international motor dealership platform: public showroom website, admin
dashboard, inventory + photo/video management, secure enquiries, customer accounts — and an
**Android mobile application** (installable PWA, Android only by design; iOS is intentionally not
targeted).

Built on a **zero-dependency** stack — Node.js 24 built-ins only (`node:sqlite`, `node:http`).
No npm install. No build step. Clone, seed, run.

---

## Quick start

```
node seed.js        # first run: creates database + staff accounts + 16 demo vehicles
node server.js      # serves the platform on http://localhost:3000
```

Then open:

| URL | What |
|---|---|
| http://localhost:3000 | Customer website |
| http://localhost:3000/admin | Admin dashboard |
| http://localhost:3000/manifest.webmanifest | Android app manifest (PWA) |

## Staff accounts (created by the seeder)

| Role | Email | Password | Can do |
|---|---|---|---|
| Admin | `admin@dmmotorgroup.com` | `Admin#2026` | Everything, incl. settings, staff management, deleting |
| Manager | `sales@dmmotorgroup.com` | `Sales#2026` | Inventory, uploads, enquiries, banners, customers — **not** dealership settings |

Change these passwords immediately in Admin → Customers (Admin login → staff tab).

## Tests

```
node server.js      # keep running in another terminal
node test/e2e.js    # 67 end-to-end tests → RESULT: 67 passed, 0 failed
```

---

## What's included

### Public website (`/`)
- **Home** — hero banners (manageable in admin), featured vehicles, latest arrivals, category rails
  (SUV / Sports / Electric / Luxury), video presentations strip, approved customer testimonials.
- **Showroom** (`/vehicles`) — filters (brand, fuel, body, price range, keyword), sorting
  (price asc/desc, newest, mileage), pagination, lazy-loaded thumbnails.
- **Vehicle detail** (`/vehicles/:slug`) — 23-field spec sheet incl. VIN, condition, registration,
  ownership info and inspection status; zoomable photo gallery (lightbox: swipe, double-tap/pinch
  zoom, captions); **full-length video player** (HTTP Range streaming — a 2-hour video plays
  start-to-finish, never cut); similar vehicles; enquiry CTAs.
- **Videos page** (`/videos`) — every vehicle with a video presentation, paginated.
- **Compare** (`/compare`) — 2–4 vehicles side-by-side (23 spec rows), compare tray follows scroll.
- **Contact** — general enquiry, WhatsApp deep-link, dealership details from settings.
- **Account** — register / login / forgot-password (token printed to server log in dev), profile,
  favourites, enquiry history, notifications (unread badge in header).
- Trust design: **no fabricated reviews or badges.** Text distinguishes "dealership-supplied" vs
  "verified" simply and honestly; testimonials only appear after admin approval.

### Admin dashboard (`/admin`)
- Dashboard KPIs: inventory counts, enquiries, media, views, customers.
- **Vehicles** — searchable/filterable list; full editor (identity, price/currency, mileage, engine,
  transmission, fuel, body, colours, VIN, condition, registration, location, description, features,
  safety features, ownership info, inspection, category, featured flag, status
  draft→published→reserved→sold).
- **Media manager** per vehicle — upload photos & videos (drag input), client-side-generated
  thumbnails, reorder (up/down), set cover image, per-item caption + category (exterior/interior/
  engine/detail), delete.
- **Enquiries pipeline** — 8 enquiry types (price, photos/videos, inspection, test-drive, delivery,
  purchase, WhatsApp, general); status workflow new→contacted→quoted→won/lost; internal notes;
  one-click reply that also drops a notification into the customer's account.
- **Customers & staff** — role-based: `admin` / `manager` / `viewer` (viewer = read-only).
- **Testimonials** — approve / reject / delete; nothing is public until approved.
- **Homepage banners** — image upload, title, subtitle, CTA link, ordering.
- **Settings** (admin only) — dealership name, phones, WhatsApp, address, social links, currency,
  and the `dev_reset_tokens` flag (**turn this off in production**, see below).
- **Activity log** — every staff mutation is recorded (who, what, when).

### Android app (PWA — Android only)
The same site is a fully installable Android application. On Android/Chrome, visitors see a
**"📲 Install the DM Motors Android app"** button (the `beforeinstallprompt` flow); installing puts
a standalone app icon on the home screen that launches full-screen with a bottom navigation bar —
no browser chrome, works offline for visited pages via the service worker.

To install (Android): open the site in Chrome → tap the install banner (or ⋮ menu → "Install app").
machines' desktop Chrome also supports install via the address-bar icon.

There is no iOS/App Store provisioning — the app targets Android only.

### Security
- scrypt password hashing, HMAC-signed session tokens (per-secret key on disk `data/secret.key`).
- Cookie sessions for browsers + Bearer tokens for the app API.
- CSRF guard: cookie-authenticated mutating requests must carry `X-Requested-With: DMFetch` or
  `DMAdmin`; cross-site form posts are rejected (403).
- Role checks on every admin route; honeypot field + duplicate-guards on public forms; rate limits
  on auth endpoints; upload extension whitelist.

### SEO
- Per-vehicle `<title>`, description, canonical, Open Graph/Twitter tags, **JSON-LD `Car`**
  structured data with real price/VIN, og:image from the uploaded cover photo.
- `sitemap.xml` (all published vehicles), `robots.txt` (blocks `/admin`, references sitemap).

---

## Project layout

```
server.js            HTTP server: static files, /media streaming (Range), SEO shell, sitemap/robots
lib/db.js            node:sqlite schema, indexes, scrypt hashing, tokens, activity log
lib/api.js           ~60 REST routes (public + /api/admin/*), auth, CSRF, uploads
seed.js              Seeder: settings, staff, 16 demo vehicles (SVG photography), demo FFmpeg video
public/              Website + Android app shell (app.js, styles.css, sw.js, manifest.webmanifest)
admin/               Admin dashboard (hash-routed SPA)
data/dm.db           SQLite database (WAL) — back this up
uploads/             Uploaded photos/videos, banner art (/uploads/banners)
test/e2e.js          67-test end-to-end suite
```

## Deploying to production

1. **Node 24+** (uses built-in `node:sqlite`). Run behind any host that forwards HTTP, e.g.:
   - `node server.js` directly, or a service manager (`pm2`, Windows Service, systemd unit).
   - Terminate TLS at a reverse proxy (nginx/Caddy/IIS) and forward port 3000 or use node's
     HTTPS if preferred.
2. Set `PUBLIC_URL` when the site is served from a real domain so absolute meta/og URLs and the
   sitemap use it (falls back to the request origin):
   - PowerShell: `$env:PUBLIC_URL = "https://dmmotorgroup.com"; node server.js`
3. **Harden auth settings** — Admin → Settings: set `dev_reset_tokens` to `0`. In dev, forgot-
   password tokens are logged to the console; in production they should be emailed instead (wire
   your mail provider at the marked spot in `lib/api.js`).
4. **Back up** `data/` folder (contains `dm.db`, WAL files, and `secret.key` — losing `secret.key`
   invalidates all sessions) and `uploads/`.
5. Serve over HTTPS — required for the Android install prompt and service worker outside localhost.
6. Restarting keeps everything: vehicles, media rows, users, banners, testimonials, settings.

### ffmpeg demo video (optional)
The seeder auto-generates a small demo walk-around clip if `ffmpeg` is on PATH. Without ffmpeg the
seeder still completes — upload real videos via the admin media manager instead. Uploaded videos are
served with HTTP Range support, so long originals play in full.

### Versioning frontend assets
When editing files under `public/` or `admin/`, bump the `?v=` parameter in the corresponding
`index.html` link/script tags and the `CACHE` name in `public/sw.js` — browsers and the service
worker otherwise serve stale copies.

---

*Demo inventory photography is generated placeholder art. Replace it by uploading real photos and
videos through the admin media manager — the platform is fully functional end-to-end.*
