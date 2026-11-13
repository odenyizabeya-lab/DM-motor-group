/* Generate the PWA PNG icons the manifest references, from the SVG source.
 * Renders the SVG in a real browser and saves PNGs at 192 and 512 px.
 * Also produces a maskable variant (logo inside the safe zone) and an
 * apple-touch-icon for iOS home screens. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9370;
const ROOT = process.cwd().replace(/\\/g, '/');
const SVG = fs.readFileSync('public/assets/icon.svg', 'utf8');

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\icon-gen-prof', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');

/* maskable: the logo is scaled to 80% and centred inside a full-bleed background */
const maskableSvg = SVG.replace('<rect width="192" height="192" rx="42" fill="url(#g)"/>', '<rect width="192" height="192" fill="#0b0d10"/><g transform="translate(19.2,19.2) scale(0.8)"><rect width="192" height="192" rx="42" fill="url(#g)"/></g>');

async function render(svg, size, outFile) {
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ')}</body></html>`;
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
  await wait(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  console.log('wrote ' + outFile + ' (' + fs.statSync(outFile).size + ' bytes)');
}

await render(SVG, 192, 'public/assets/icon-192.png');
await render(SVG, 512, 'public/assets/icon-512.png');
await render(maskableSvg, 192, 'public/assets/maskable-192.png');
await render(maskableSvg, 512, 'public/assets/maskable-512.png');
/* iOS home-screen icon: opaque background, no transparency */
const appleSvg = SVG.replace('<svg ', '<svg style="background:#0b0d10" ');
await render(appleSvg, 180, 'public/apple-touch-icon.png');

ws.close(); chrome.kill(); process.exit(0);
