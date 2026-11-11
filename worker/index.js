/* =============================================================================
 * DM Motor Group — AI automation heartbeat.
 * A tiny Worker with a 1-minute cron that calls the Pages API tick endpoint.
 * This is what makes the system run without anyone's browser or phone online.
 * The shared secret lives in Worker secrets + Pages env (never in frontend).
 * ========================================================================== */

async function tick(env) {
  const url = env.AI_TICK_URL;
  const key = env.AI_INTERNAL_KEY;
  if (!url || !key) return { ok: false, error: 'AI_TICK_URL or AI_INTERNAL_KEY is not configured.' };

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: '{}',
      });
      const text = await res.text();
      if (res.ok) {
        console.log('tick ok', text.slice(0, 500));
        return { ok: true, status: res.status, body: text.slice(0, 800) };
      }
      lastError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
      /* 4xx other than 429 will not fix themselves; stop early. */
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  console.error('tick failed', lastError);
  return { ok: false, error: lastError };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(tick(env));
  },

  /* Manual trigger for setup/testing: GET /?key=<AI_INTERNAL_KEY> */
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.searchParams.get('key') || request.headers.get('x-internal-key') || '';
    if (!env.AI_INTERNAL_KEY || key !== env.AI_INTERNAL_KEY) {
      return new Response('Forbidden', { status: 403 });
    }
    const result = await tick(env);
    return Response.json(result);
  },
};
