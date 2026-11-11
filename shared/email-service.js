/* =============================================================================
 * DM Motor Group — outbound & inbound email service.
 * Primary provider: Resend (free tier covers 3,000 emails/month, 100/day,
 * including inbound receiving). Optional fallback: Brevo transactional API.
 * Credentials are read from the server-only `ai_secrets` table or from
 * Cloudflare environment secrets — never from the browser.
 * ========================================================================== */
'use strict';

const RESEND = 'https://api.resend.com';
const BREVO = 'https://api.brevo.com/v3';

/* ------------------------------------------------------------------ helpers */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const b64ToBytes = (b64) => {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const bytesToHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmacValid(secret, payload, signatureB64) {
  const keyBytes = b64ToBytes(String(secret).replace(/^whsec_/, ''));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = bytesToB64(sig);
  if (expected.length !== String(signatureB64).length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ String(signatureB64).charCodeAt(i);
  return diff === 0;
}

/* Svix webhook verification used by Resend. Returns true only for a genuine,
 * non-replayed request. */
async function verifyWebhook(secret, rawBody, headers, toleranceSeconds = 300) {
  if (!secret) return false;
  const id = headers.get('svix-id') || headers.get('webhook-id') || '';
  const ts = headers.get('svix-timestamp') || headers.get('webhook-timestamp') || '';
  const sigHeader = headers.get('svix-signature') || headers.get('webhook-signature') || '';
  if (!id || !ts || !sigHeader) return false;
  const now = Math.floor(Date.now() / 1000);
  const stamp = parseInt(ts, 10);
  if (!Number.isFinite(stamp) || Math.abs(now - stamp) > toleranceSeconds) return false;
  const signed = `${id}.${ts}.${rawBody}`;
  const signatures = sigHeader.split(' ').map((s) => s.trim()).filter(Boolean);
  for (const entry of signatures) {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) continue;
    if (await hmacValid(secret, signed, sig)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- templates */
function textToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.72;color:#2c3038;font-size:15px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function renderEmail({ businessName = 'DM Motor Group', teamName = 'Customer Relations Team', subject = '', text = '', website = 'https://dmmotorgroup.com', replyTo = '' }) {
  const body = textToHtml(text);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e1d7">
        <tr><td style="background:#0d0f12;padding:26px 32px;border-bottom:3px solid #c9a227">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:23px;letter-spacing:2px;color:#f5efe0">${esc(businessName)}</div>
          <div style="font-size:10.5px;letter-spacing:3px;color:#c9a227;margin-top:4px;text-transform:uppercase">Premium International Automobiles</div>
        </td></tr>
        <tr><td style="padding:32px 32px 8px">${body}</td></tr>
        <tr><td style="padding:8px 32px 30px">
          <p style="margin:26px 0 0;line-height:1.7;color:#2c3038;font-size:15px">Warm regards,<br><b>${esc(businessName)}</b><br>${esc(teamName)}</p>
          ${replyTo ? `<p style="margin:18px 0 0;font-size:12px;color:#8b8f97">You can reply directly to this email${replyTo ? ` at <a href="mailto:${esc(replyTo)}" style="color:#9a7b16">${esc(replyTo)}</a>` : ''}.</p>` : ''}
        </td></tr>
        <tr><td style="background:#faf8f3;border-top:1px solid #e6e1d7;padding:18px 32px;font-size:11.5px;color:#8b8f97;line-height:1.6">
          ${esc(businessName)} · <a href="${esc(website)}" style="color:#9a7b16;text-decoration:none">${esc(website.replace(/^https?:\/\//, ''))}</a><br>
          This message was sent in response to your enquiry. We communicate with our customers by email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { html, text: String(text || '') };
}

/* ------------------------------------------------------------- config load */
/* Read settings + secrets from the database. Both are service-role only. */
async function loadConfig(env, rest) {
  const [settingsRows, secretRows] = await Promise.all([
    rest.get(env, 'ai_settings', { id: 'eq.1', select: '*' }).catch(() => []),
    rest.get(env, 'ai_secrets', { select: 'key,value' }).catch(() => []),
  ]);
  const settings = (settingsRows && settingsRows[0]) || {};
  const secrets = Object.fromEntries(((secretRows || [])).map((r) => [r.key, r.value]).filter(([, v]) => v));
  const pick = (key, envKey) => secrets[key] || (envKey ? env[envKey] : '') || '';
  return {
    settings,
    secrets,
    resendKey: pick('resend_api_key', 'RESEND_API_KEY'),
    brevoKey: pick('brevo_api_key', 'BREVO_API_KEY'),
    webhookSecret: pick('resend_webhook_secret', 'RESEND_WEBHOOK_SECRET'),
    geminiKey: pick('gemini_api_key', 'GEMINI_API_KEY'),
    openaiKey: pick('openai_api_key', 'OPENAI_API_KEY'),
    internalKey: pick('internal_key', 'AI_INTERNAL_KEY'),
  };
}

/* ---------------------------------------------------------------- outbound */
function fromHeader(settings) {
  const email = String(settings.from_email || '').trim();
  const name = String(settings.from_name || settings.business_name || 'DM Motor Group').trim();
  return email ? `${name.replace(/[<>"]/g, '')} <${email}>` : '';
}

function replyAddress(settings, token) {
  const domain = String(settings.reply_domain || '').trim().replace(/^@/, '');
  return domain && token ? `reply+${token}@${domain}` : (String(settings.from_email || '').trim() || '');
}

/**
 * Send one email. Never fakes delivery: a non-2xx provider response throws.
 * @returns {{ id: string, provider: string }}
 */
async function sendEmail(env, rest, {
  to, subject, text, html, replyTo = '', from = '', headers = {}, idempotencyKey = '',
}) {
  const cfg = await loadConfig(env, rest);
  const s = cfg.settings || {};
  const recipient = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipient.length) throw new Error('No recipient address.');
  const sender = from || fromHeader(s);
  if (!sender) throw new Error('Sender email is not configured. Add it in AI Customer Service → Settings.');
  const body = { subject: String(subject || '').slice(0, 240) || 'A message from DM Motor Group', text: text || '', html: html || textToHtml(text) };

  const errors = [];

  if (cfg.resendKey) {
    try {
      const payload = { from: sender, to: recipient, subject: body.subject, text: body.text, html: body.html };
      if (replyTo) payload.reply_to = replyTo;
      if (Object.keys(headers).length) payload.headers = headers;
      const res = await fetch(`${RESEND}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.resendKey}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).slice(0, 200) } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.id) return { id: data.id, provider: 'resend' };
      errors.push(`Resend ${res.status}: ${(data && (data.message || data.error)) || 'rejected'}`);
    } catch (e) { errors.push(`Resend: ${e.message}`); }
  } else {
    errors.push('Resend API key is not configured');
  }

  if (cfg.brevoKey) {
    try {
      const payload = {
        sender: { email: (sender.match(/<([^>]+)>/) || [])[1] || sender, name: (sender.match(/^([^<]+)</) || [])[1]?.trim() || s.business_name || 'DM Motor Group' },
        to: recipient.map((email) => ({ email })),
        subject: body.subject,
        htmlContent: body.html,
        textContent: body.text,
      };
      if (replyTo) payload.replyTo = { email: replyTo };
      const res = await fetch(`${BREVO}/smtp/email`, {
        method: 'POST',
        headers: { 'api-key': cfg.brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.messageId) return { id: data.messageId, provider: 'brevo' };
      errors.push(`Brevo ${res.status}: ${(data && (data.message || data.code)) || 'rejected'}`);
    } catch (e) { errors.push(`Brevo: ${e.message}`); }
  }

  throw new Error(errors.join(' · ') || 'No email provider is configured.');
}

/* Fetch the full body of a received email (Resend inbound). */
async function fetchReceivedEmail(env, rest, emailId) {
  const cfg = await loadConfig(env, rest);
  if (!cfg.resendKey) throw new Error('Resend API key is not configured.');
  const res = await fetch(`${RESEND}/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${cfg.resendKey}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend inbound fetch failed (${res.status}): ${(data && (data.message || data.error)) || ''}`);
  return data;
}

/* Plain-text version of an inbound HTML email, used for the AI prompt. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Strip quoted reply chains so the AI sees only the new message. */
function stripQuoted(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^\s*On .+ wrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && out.length > 3) break;
    if (/^\s*>{1,}\s?/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

const emailService = {
  sendEmail, loadConfig, fromHeader, replyAddress,
  renderEmail, textToHtml, htmlToText, stripQuoted,
  verifyWebhook, fetchReceivedEmail, esc,
};
export default emailService;
export { emailService };
