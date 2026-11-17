/* Local preview of the BUILT dist/ folder: static files + /api proxied to the
 * live production API, so pages can be tested exactly as they will deploy. */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8931;
const ROOT = path.resolve('dist');
const UP = 'https://dmmotorgroup.com';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

const proxy = (req, res) => {
  const headers = { ...req.headers, host: 'dmmotorgroup.com' };
  delete headers.referer; delete headers.origin;
  const r = https.request(UP + req.url, { method: req.method, headers }, (pr) => {
    res.writeHead(pr.statusCode, pr.headers);
    pr.pipe(res);
  });
  r.on('error', () => { res.writeHead(502); res.end('proxy error'); });
  req.pipe(r);
};

http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/sw.js')) return proxy(req, res);
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) {
      /* SPA routes fall back to index.html like the worker does */
      f = path.join(ROOT, 'index.html');
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no dist'); }
    }
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}).listen(PORT, () => console.log('preview http://127.0.0.1:' + PORT));
