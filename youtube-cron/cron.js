/* DM Motor Group — YouTube Marketing Automation: daily cron trigger.
 *
 * Cloudflare Workers free tier. Fires every 30 minutes; the site's internal
 * tick (/api/internal/youtube/tick) decides whether today's scheduled video
 * should go out yet (timezone-aware) — so a 30-minute cron is safe.
 *
 * The Worker holds ONE secret: INTERNAL_KEY — the same internal key your site
 * uses for /api/internal/ai/tick (Admin → Integrations → internal key, or the
 * AI_INTERNAL_KEY Pages secret). No Google credentials or OAuth tokens are
 * stored here: token handling happens server-side at dmmotorgroup.com.
 */
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
};

async function run(env) {
  const url = env.TICK_URL || 'https://dmmotorgroup.com/api/internal/youtube/tick';
  const key = env.INTERNAL_KEY;
  if (!key) {
    console.log('[dm-youtube-cron] INTERNAL_KEY is not set — nothing to do. Add it with: wrangler secret put INTERNAL_KEY');
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'x-internal-key': key },
      signal: controller.signal,
    });
    const body = await r.text();
    console.log('[dm-youtube-cron] tick', r.status, body.slice(0, 400));
  } catch (e) {
    console.log('[dm-youtube-cron] tick failed:', String((e && e.message) || e));
  } finally {
    clearTimeout(timeout);
  }
}
