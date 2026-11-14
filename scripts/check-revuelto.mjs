for (let i = 0; i < 3; i++) {
  const r = await fetch('https://dmmotorgroup.com/api/vehicles/lamborghini-revuelto-2024');
  const t = await r.text();
  console.log('api attempt', i + 1, '| status', r.status, '| len', t.length, '| head:', t.slice(0, 140));
}
