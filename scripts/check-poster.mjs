const urls = [
  'https://gevxgqdevaanmxqzverv.supabase.co/storage/v1/object/public/vehicle-media/v44/1f2633a32334ac844a559b9c64ad53b0-poster.jpg',
  'https://gevxgqdevaanmxqzverv.supabase.co/storage/v1/object/public/vehicle-media/v40/3da3efa1531b27e7f92ed00489be2957-poster.jpg',
];
for (const u of urls) {
  const r = await fetch(u);
  const b = new Uint8Array(await r.arrayBuffer());
  console.log(r.status, r.headers.get('content-type'), b.length, 'bytes', 'magic', [...b.slice(0, 4)].map((x) => x.toString(16)).join(' '));
}
