const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const groups = JSON.parse(fs.readFileSync('/tmp/video-hashes.json', 'utf8'));
const report = JSON.parse(fs.readFileSync('/tmp/video-report.json', 'utf8'));
const byPath = new Map(report.map((r) => [r.p, r]));
const outDir = 'C:\\Users\\HP\\AppData\\Local\\Temp\\opencode\\frames';
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
groups.forEach((g, i) => {
  const r = byPath.get(g.keep);
  if (!r) { console.log('MISSING REPORT', g.keep); return; }
  const dur = parseFloat(r.dur);
  const times = [Math.min(0.8, dur * 0.08), dur * 0.5, Math.max(0.2, dur - 0.9)];
  const idx = String(i + 1).padStart(2, '0');
  const frames = [];
  times.forEach((t, n) => {
    const out = path.join(outDir, `${idx}_${n + 1}.jpg`);
    try {
      cp.execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', g.keep, '-frames:v', '1', '-q:v', '3', '-y', out], { timeout: 60000 });
      if (fs.existsSync(out)) frames.push(out);
    } catch (e) { console.log('FRAME FAIL', idx, n, String(e.message).split('\n')[0]); }
  });
  manifest.push({ index: i + 1, keep: g.keep, dur, dims: `${r.w}x${r.h}`, sizeKB: Math.round(r.size / 1024), frames, duplicates: g.duplicates });
  console.log(`${idx}\t${r.w}x${r.h}\t${Math.round(dur)}s\t${g.keep}`);
});
fs.writeFileSync('/tmp/frames-manifest.json', JSON.stringify(manifest, null, 2));
console.log('FRAMES DIR', outDir);
