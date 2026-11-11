const fs = require('fs');
const path = require('path');
const dir = 'C:\\Users\\HP\\Downloads';
const exts = new Set(['.mp4', '.webm', '.m4v', '.mov']);
const out = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['.aider', '.android', '.azad', '.cache', '.claude', '.cline', '.codeium', '.config', '.continue', '.copilot', '.cursor', '.docker', '.gradle', '.idlerc', '.n8n', '.ollama', '.openhands', '.pearai', '.ssh', '.supabase', '.turso', '.vercel', '.vscode', '.vscode-dictation', '.vscode-shared', '.local', '.nuget', '.matplotlib', '.copilot', 'AppData', 'Application Data', 'Contacts', 'Cookies', 'Desktop', 'Documents', 'Favorites', 'Links', 'Music', 'My Documents', 'NetHood', 'OneDrive', 'Pictures', 'PrintHood', 'Recent', 'IntelGraphicsProfiles', 'house for sale', 'houses vidoes app', 'kco-global-online-marketplace', 'my_kco_ai'].some(x => x.toLowerCase() === e.name.toLowerCase())) walk(p); }
    else if (exts.has(e.name.slice(e.name.lastIndexOf('.')).toLowerCase())) {
      const st = fs.statSync(p);
      out.push({ p, size: st.size, mtime: st.mtime });
    }
  }
}
walk(dir);
for (const f of out) console.log(`${f.size}\t${f.mtime.toISOString()}\t${f.p}`);
console.log('TOTAL', out.length);
