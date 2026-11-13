/* Market research via a real browser (DuckDuckGo lite) - bypasses bot challenges.
 * Prints compact priced snippets per query and saves a JSON digest. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9360;

const QUERIES = [
  ['honda-accord-2016', '2016 Honda Accord sedan used price value'],
  ['chevrolet-silverado-1500-2021', '2021 Chevrolet Silverado 1500 used price value'],
  ['honda-civic-2019', '2019 Honda Civic sedan used price value'],
  ['toyota-corolla-2006', '2006 Toyota Corolla used price value'],
  ['ford-f150-2022', '2022 Ford F-150 used price value'],
  ['ford-f250-2019', '2019 Ford F-250 Super Duty used price value'],
  ['tesla-model-3-2021', '2021 Tesla Model 3 used price value'],
  ['mercedes-gle53-coupe', '2021 Mercedes AMG GLE 53 Coupe used price'],
  ['ford-ranger-raptor-2023', '2023 Ford Ranger Raptor used price value'],
  ['ferrari-laferrari', 'Ferrari LaFerrari price value auction'],
  ['lamborghini-revuelto', 'Lamborghini Revuelto MSRP price 2024'],
  ['rolls-royce-cullinan-2025', '2025 Rolls-Royce Cullinan MSRP price'],
  ['ford-mustang-gt-2019', '2019 Ford Mustang GT used price value'],
  ['bugatti-chiron-super-sport', '2020 Bugatti Chiron Super Sport 300+ price for sale'],
  ['bugatti-chiron-2020', '2020 Bugatti Chiron used price for sale'],
  ['byd-seal-2023', '2023 BYD Seal used price value'],
  ['mercedes-sclass-coupe-2019', '2019 Mercedes-Benz S-Class Coupe used price value'],
  ['plymouth-barracuda-1970', '1970 Plymouth Barracuda price value auction'],
];

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\market-prof',
  'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
    target = list.find((t) => t.type === 'page');
  } catch {}
}
if (!target) { console.error('no chrome target'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return '';
  return (r.result && r.result.value) || '';
};
await send('Page.enable'); await send('Runtime.enable');

let out = {};
try { out = JSON.parse(fs.readFileSync('.tmp-scan/market/research.json', 'utf8')); } catch {}

for (const [key, q] of QUERIES) {
  if (out[key] && out[key].snippets && out[key].snippets.length) { console.log('=== ' + key + ' (cached)'); continue; }
  const url = 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&count=20';
  await send('Page.navigate', { url });
  await wait(4500);
  const text = await evl('document.body ? document.body.innerText : ""');
  const parts = String(text).split(/\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const priced = [...new Set(parts.filter((p) => /\$[\d,]{3,}/.test(p) && p.length > 45 && p.length < 400))].slice(0, 6);
  out[key] = { query: q, snippets: priced };
  console.log('\n=== ' + key + '  [' + q + ']');
  if (!priced.length) console.log('  (none)');
  for (const s of priced) console.log('  - ' + s.replace(/\s+/g, ' ').slice(0, 280));
  fs.writeFileSync('.tmp-scan/market/research.json', JSON.stringify(out, null, 1));
  await wait(3500);
}
ws.close(); chrome.kill(); process.exit(0);
