/* Upload the user's downloaded car videos to the DM Motor Group showroom.
 * - creates a published listing per car
 * - uploads the ORIGINAL video file (no transcode → original quality preserved)
 * - extracts a poster frame, uploads it as the video thumbnail + listing cover
 * - idempotent: re-running skips anything already uploaded
 * Originals are only read, never modified.
 */
import fs from 'node:fs';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { listings } from './video-listings.mjs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SB = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;
const AUTH = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const TMP = 'C:\\Users\\HP\\AppData\\Local\\Temp\\opencode\\posters';
fs.mkdirSync(TMP, { recursive: true });

const report = JSON.parse(fs.readFileSync('/tmp/video-report.json', 'utf8'));
const durByPath = new Map(report.map((r) => [r.p, parseFloat(r.dur)]));

async function rest(p, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  const res = await fetch(`${SB}/rest/v1/${p}`, {
    method,
    headers: { ...AUTH, 'Content-Type': 'application/json', Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function putObject(bucket, objectPath, buf, contentType) {
  const url = `${SB}/storage/v1/object/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': 'public, max-age=31536000, immutable' },
    body: buf,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`STORAGE ${objectPath} → ${res.status} ${text.slice(0, 300)}`);
  return `${SB}/storage/v1/object/public/${bucket}/${objectPath}`;
}

function makePoster(file, out, dur) {
  const t = Math.max(0.2, Math.min(2.5, (dur || 3) * 0.35));
  cp.execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-q:v', '3', '-y', out], { timeout: 120000 });
  return out;
}

const results = [];
let created = 0, skippedVehicles = 0, uploadedVideos = 0, skippedVideos = 0, covers = 0;
const errors = [];
const only = process.argv[2] && process.argv[2].startsWith('--only=') ? process.argv[2].slice(7) : null;
const work = only ? listings.filter((l) => l.slug === only) : listings;
if (only && !work.length) { console.error('No listing matches', only); process.exit(1); }

for (const item of work) {
  const log = { slug: item.slug, vehicleId: null, videos: [], errors: [] };
  try {
    let v = (await rest(`vehicles?slug=eq.${encodeURIComponent(item.slug)}&select=*`))[0];
    if (v) {
      skippedVehicles++;
      log.vehicleId = v.id;
      console.log(`SKIP vehicle exists: ${item.slug} (#${v.id})`);
    } else {
      const payload = {
        slug: item.slug, status: item.status, brand: item.brand, model: item.model, year: item.year,
        price: item.price, currency: item.currency, mileage: item.mileage,
        engine: item.engine, transmission: item.transmission, fuel: item.fuel,
        body_type: item.bodyType, exterior_color: item.exteriorColor, interior_color: item.interiorColor,
        vin: item.vin, condition: item.condition, registration: item.registration, location: item.location,
        description: item.description, features: item.features, safety_features: item.safetyFeatures,
        inspection_status: item.inspectionStatus, category: item.category, is_featured: item.isFeatured,
      };
      v = (await rest('vehicles', { method: 'POST', body: payload }))[0];
      created++;
      log.vehicleId = v.id;
      console.log(`CREATE vehicle: ${item.slug} (#${v.id})`);
    }

    let pos = 10;
    let firstPosterUrl = null;
    for (let n = 0; n < item.videos.length; n++) {
      const vid = item.videos[n];
      if (!fs.existsSync(vid.file)) { log.errors.push(`missing file ${vid.file}`); continue; }
      const buf = fs.readFileSync(vid.file);
      const hash = crypto.createHash('md5').update(buf).digest('hex');
      const ext = (vid.file.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || 'mp4';
      const videoPath = `v${v.id}/${hash}.${ext}`;
      const posterPath = `v${v.id}/${hash}-poster.jpg`;
      const videoUrl = `${SB}/storage/v1/object/public/vehicle-media/${videoPath}`;
      const posterUrl = `${SB}/storage/v1/object/public/vehicle-media/${posterPath}`;

      // poster + cover (upload if missing)
      let havePoster = await rest(`media?url=eq.${encodeURIComponent(posterUrl)}&select=id`);
      if (!havePoster.length) {
        const localPoster = path.join(TMP, `${hash}.jpg`);
        makePoster(vid.file, localPoster, durByPath.get(vid.file));
        await putObject('vehicle-media', posterPath, fs.readFileSync(localPoster), 'image/jpeg');
        if (n === 0) {
          const imgRow = (await rest('media', { method: 'POST', body: {
            vehicle_id: v.id, type: 'image', url: posterUrl, thumb_url: posterUrl,
            caption: 'Video preview', category: 'exterior', position: 0,
          } }))[0];
          await rest(`vehicles?id=eq.${v.id}`, { method: 'PATCH', body: {
            cover_media_id: imgRow.id, cover: posterUrl, cover_full: posterUrl, updated_at: new Date().toISOString(),
          } });
          covers++;
        }
      }
      firstPosterUrl = firstPosterUrl || posterUrl;

      const haveVid = await rest(`media?url=eq.${encodeURIComponent(videoUrl)}&select=id`);
      if (haveVid.length) { skippedVideos++; console.log(`  SKIP video already uploaded: ${hash.slice(0, 8)}`); log.videos.push({ file: vid.file, url: videoUrl, skipped: true }); continue; }

      await putObject('vehicle-media', videoPath, buf, ext === 'mp4' ? 'video/mp4' : `video/${ext}`);
      const row = (await rest('media', { method: 'POST', body: {
        vehicle_id: v.id, type: 'video', url: videoUrl, thumb_url: posterUrl,
        caption: vid.caption, category: 'video', position: pos++,
      } }))[0];
      uploadedVideos++;
      log.videos.push({ file: vid.file, url: videoUrl, mediaId: row.id, bytes: buf.length });
      console.log(`  UPLOAD video ${hash.slice(0, 8)} (${(buf.length / 1048576).toFixed(1)}MB) → ${item.slug}`);
    }
    results.push(log);
  } catch (e) {
    console.error(`FAIL ${item.slug}: ${e.message}`);
    log.errors.push(e.message);
    errors.push({ slug: item.slug, error: e.message });
    results.push(log);
  }
}

fs.writeFileSync('/tmp/upload-results.json', JSON.stringify({ created, skippedVehicles, uploadedVideos, skippedVideos, covers, errors, results }, null, 2));
console.log(`\nDONE created=${created} existing=${skippedVehicles} videosUploaded=${uploadedVideos} videosSkipped=${skippedVideos} covers=${covers} errors=${errors.length}`);
