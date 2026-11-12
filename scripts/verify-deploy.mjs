/* Post-deploy verification of asset versions, section order and sw fixes. */
const A = 'https://dmmotorgroup.com';
const h = await fetch(A + '/', { headers: { accept: 'text/html' } });
const t = await h.text();
console.log('apex /', h.status, '| app ref:', (t.match(/app.js\?v=\d+/) || [])[0], '| sw ref:', (t.match(/sw\.js\?v=\d+/) || [])[0]);

const a = await fetch(A + '/app.js?v=9');
const at = await a.text();
const iV = at.indexOf('id="secVideos"');
const iF = at.indexOf('id="secFeatured"');
console.log('app.js?v=9', a.status, '| rail order fix present:', iV > -1 && iV < iF, '| pager rebind present:', at.includes('fresh cards need their click handlers'));

const s = await fetch(A + '/sw.js');
const st = await s.text();
console.log('sw.js', s.status, '| dm-v10:', st.includes("dm-v10"), '| precache app?v=9:', st.includes('/app.js?v=9'), '| precache styles?v=6:', st.includes('/styles.css?v=6'), '| ok-only caching:', st.includes('if (r.ok)'));
console.log('sw.js Cache-Control:', s.headers.get('cache-control'));

const sh = await fetch(A + '/styles.css?v=6');
console.log('styles.css?v=6', sh.status);
