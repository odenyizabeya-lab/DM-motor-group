const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const manifest = JSON.parse(fs.readFileSync('/tmp/frames-manifest.json', 'utf8'));
const outDir = 'C:\\Users\\HP\\AppData\\Local\\Temp\\opencode\\sheets';
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const m of manifest) {
  if (!m.frames.length) continue;
  const out = path.join(outDir, `${String(m.index).padStart(2, '0')}.jpg`);
  const args = ['-hide_banner', '-loglevel', 'error'];
  for (const f of m.frames) args.push('-i', f);
  const n = m.frames.length;
  const filters = m.frames.map((_, i) => `[${i}:v]scale=400:600:force_original_aspect_ratio=decrease,pad=400:600:(ow-iw)/2:(oh-ih)/2:color=black[v${i}]`).join(';');
  const stack = m.frames.map((_, i) => `[v${i}]`).join('') + `hstack=${n}[out]`;
  args.push('-filter_complex', filters + ';' + stack, '-map', '[out]', '-q:v', '3', '-y', out);
  try {
    cp.execFileSync('ffmpeg', args, { timeout: 120000 });
    console.log('SHEET', out);
  } catch (e) {
    console.log('SHEET FAIL', m.index, String(e.message).split('\n')[0]);
  }
}
