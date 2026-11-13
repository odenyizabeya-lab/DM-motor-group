/* Extract frames from every vehicle video + download cover photos.
 * Output: .tmp-scan/frames/*.jpg and .tmp-scan/manifest.json */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const veh = JSON.parse(fs.readFileSync('.tmp-scan/vehicles.json', 'utf8'));
fs.mkdirSync('.tmp-scan/frames', { recursive: true });

const manifest = [];
for (const v of veh) {
  const rec = { id: v.id, slug: v.slug, label: `${v.year} ${v.brand} ${v.model}`, frames: [], cover: null, videos: [] };
  /* cover photo */
  try {
    const cov = v.cover;
    if (cov) {
      const out = `.tmp-scan/frames/v${v.id}-cover.jpg`;
      execFileSync('curl', ['-s', '-L', '-o', out, cov], { stdio: 'ignore', timeout: 60000 });
      if (fs.existsSync(out) && fs.statSync(out).size > 1000) rec.cover = out;
    }
  } catch {}
  /* videos */
  v.videos.forEach((vid, vi) => {
    const vrec = { vid: vid.id, url: vid.url, frames: [] };
    try {
      const tmp = `.tmp-scan/frames/_v${vid.id}.mp4`;
      execFileSync('curl', ['-s', '-L', '-o', tmp, vid.url], { stdio: 'ignore', timeout: 300000 });
      const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp], { encoding: 'utf8' }).trim());
      vrec.duration = dur;
      const n = dur > 45 ? 5 : 4;
      for (let i = 0; i < n; i++) {
        const t = Math.max(0.5, Math.min(dur - 0.3, dur * (0.12 + i * (0.76 / (n - 1)))));
        const out = `.tmp-scan/frames/v${v.id}-vid${vi + 1}-f${i + 1}.jpg`;
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', tmp, '-frames:v', '1', '-vf', 'scale=480:-1', '-q:v', '5', out], { stdio: 'ignore', timeout: 60000 });
        if (fs.existsSync(out) && fs.statSync(out).size > 1000) vrec.frames.push({ file: out, t: +t.toFixed(1) });
      }
      fs.unlinkSync(tmp);
    } catch (e) { vrec.error = String(e).slice(0, 100); }
    rec.videos.push(vrec);
    rec.frames.push(...vrec.frames.map((f) => f.file));
  });
  manifest.push(rec);
  console.log(`${v.id} ${v.year} ${v.brand} ${v.model}: cover=${rec.cover ? 'ok' : 'no'} frames=${rec.frames.length}`);
}
fs.writeFileSync('.tmp-scan/manifest.json', JSON.stringify(manifest, null, 1));
const total = manifest.reduce((a, r) => a + r.frames.length, 0);
console.log('\nTOTAL frames:', total, '| covers:', manifest.filter((r) => r.cover).length);
