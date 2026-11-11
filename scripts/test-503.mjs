for (const base of ['https://dmmotorgroup.com', 'https://fc27aeac.dm-motor-group-9dq.pages.dev']) {
  const r = await fetch(base + '/api/webhooks/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'email.sent' }),
  });
  const t = await r.text();
  console.log(base, '->', r.status, r.headers.get('content-type'), t.slice(0, 120).replace(/\s+/g, ' '));
}
