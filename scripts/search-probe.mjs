/* Test which search source works reliably. Prints first priced snippet only. */
const q = process.argv[2] || '2019 Ford Mustang GT used price';
const sources = [
  ['ddg-lite', 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q)],
  ['bing', 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&format=rss'],
  ['ddg-html', 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q)],
  ['mojeek', 'https://www.mojeek.com/search?q=' + encodeURIComponent(q)],
];
for (const [name, url] of sources) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', accept: 'text/html,application/xhtml+xml' } });
    const html = await r.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
    const priced = text.split(/(?<=[.!?])\s+/).filter((p) => /\$[\d,]{3,}/.test(p) && p.length > 40 && p.length < 350);
    console.log('[' + name + '] status=' + r.status + ' len=' + html.length + ' pricedSnippets=' + priced.length);
    if (priced[0]) console.log('   ' + priced[0].slice(0, 220));
    else console.log('   head: ' + text.slice(0, 160));
  } catch (e) {
    console.log('[' + name + '] ERROR ' + String(e).slice(0, 100));
  }
  await new Promise((r) => setTimeout(r, 2500));
}
