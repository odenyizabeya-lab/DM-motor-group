const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const exts = new Set(['.mp4', '.webm', '.m4v', '.mov']);
const dir = 'C:\\Users\\HP\\Downloads';
const out = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    const low = e.name.toLowerCase();
    if (e.isDirectory()) {
      if (!['.aider','.android','.azad','.cache','.claude','.cline','.codeium','.config','.continue','.copilot','.cursor','.docker','.gradle','.idlerc','.n8n','.ollama','.openhands','.pearai','.ssh','.supabase','.turso','.vercel','.vscode','.vscode-dictation','.vscode-shared','.local','.nuget','.matplotlib','.copilot','AppData','Application Data','Contacts','Cookies','Desktop','Documents','Favorites','Links','Music','My Documents','NetHood','OneDrive','Pictures','PrintHood','Recent','IntelGraphicsProfiles','house for sale','houses vidoes app','kco-global-online-marketplace','my_kco_ai'].some(x => x.toLowerCase() === low)) walk(p);
    } else if (exts.has(low.slice(low.lastIndexOf('.')))) {
      const st = fs.statSync(p);
      out.push({ p, size: st.size, mtime: st.mtime });
    }
  }
}
walk(dir);
const rows = [];
for (const f of out.sort((a, b) => a.p.localeCompare(b.p))) {
  let dur = 'N/A', vcodec = 'N/A', w = '?', h = '?';
  try {
    const args = ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', f.p];
    const j = JSON.parse(cp.execFileSync('ffprobe', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }));
    const fm = j.format || {};
    const streams = (j.streams || []).filter((s) => s.codec_type === 'video');
    const v = streams[0] || {};
    dur = fm.duration ?? 'N/A'; vcodec = v.codec_name ?? 'N/A'; w = v.width ?? '?'; h = v.height ?? '?';
  } catch (e) { dur = 'CORRUPT'; }
  rows.push({ p: f.p, size: f.size, mtime: f.mtime, dur, vcodec, w, h });
}
fs.writeFileSync('/tmp/video-report.json', JSON.stringify(rows, null, 2));
for (const r of rows) {
  const kb = (r.size / 1024).toFixed(1);
  console.log(`${r.dur}\t${kb}KB\t${r.w}x${r.h}\t${r.vcodec}\t${r.mtime.toISOString()}\t${r.p}`);
}
console.log('TOTAL', rows.length);
