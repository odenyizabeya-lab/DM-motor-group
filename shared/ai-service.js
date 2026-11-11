/* =============================================================================
 * DM Motor Group — AI text generation (customer relations).
 * Primary: Google Gemini free tier. Alternative: OpenAI.
 * Keys are server-only. Output is a strict JSON contract so the automation
 * can decide safely whether to send, escalate or pause.
 * ========================================================================== */
'use strict';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_BASE = 'https://api.openai.com/v1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(unfenced); } catch {}
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(unfenced.slice(start, end + 1)); } catch {}
  }
  return null;
}

/* Gemini text chat. `messages` = [{ role: 'user'|'model', text }]. */
async function geminiChat({ apiKey, model = 'gemini-2.5-flash', system, messages, temperature = 0.65, json = true }) {
  if (!apiKey) throw Object.assign(new Error('Gemini API key is not configured.'), { code: 'NO_KEY', provider: 'gemini' });
  const contents = (messages || []).map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] }));
  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 1400,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Gemini request failed (${res.status})`;
    const e = new Error(msg);
    e.provider = 'gemini';
    e.status = res.status;
    e.code = /SUSPENDED|has been suspended/i.test(msg) ? 'SUSPENDED'
      : /quota|exceeded/i.test(msg) ? 'QUOTA'
      : /API key not valid|API_KEY_INVALID/i.test(msg) ? 'BAD_KEY'
      : 'UPSTREAM';
    throw e;
  }
  const parts = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || []);
  const text = parts.map((p) => (p && p.text) || '').join('').trim();
  if (!text) throw Object.assign(new Error('Gemini returned an empty response.'), { provider: 'gemini', code: 'EMPTY' });
  return { text, model, provider: 'gemini' };
}

/* OpenAI chat. `messages` = [{ role: 'system'|'user'|'assistant', content }]. */
async function openaiChat({ apiKey, model = 'gpt-4o-mini', system, messages, temperature = 0.65, json = true }) {
  if (!apiKey) throw Object.assign(new Error('OpenAI API key is not configured.'), { code: 'NO_KEY', provider: 'openai' });
  const payload = {
    model,
    temperature,
    max_tokens: 1400,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...(messages || []).map((m) => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.text })),
    ],
  };
  if (json) payload.response_format = { type: 'json_object' };
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error)) || `OpenAI request failed (${res.status})`;
    const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    e.provider = 'openai';
    e.status = res.status;
    e.code = res.status === 429 ? 'QUOTA' : 'UPSTREAM';
    throw e;
  }
  const text = String((((data.choices || [])[0] || {}).message || {}).content || '').trim();
  if (!text) throw Object.assign(new Error('OpenAI returned an empty response.'), { provider: 'openai', code: 'EMPTY' });
  return { text, model, provider: 'openai' };
}

/**
 * Generate a reply decision. Falls back from Gemini to OpenAI only when an
 * OpenAI key exists. Retries transient failures with backoff.
 * @returns {Promise<{reply,subject,intent,escalate,pause_ai,suggested_inspection_status,provider,model}>}
 */
async function generateReply({ geminiKey, openaiKey, provider = 'gemini', geminiModel, openaiModel, system, messages, temperature = 0.65 }) {
  const attempts = [
    { provider: 'gemini', key: geminiKey, model: geminiModel || 'gemini-2.5-flash' },
    { provider: 'openai', key: openaiKey, model: openaiModel || 'gpt-4o-mini' },
  ].filter((p) => p.key);
  if (!attempts.length) throw Object.assign(new Error('No AI provider key is configured. Add a Gemini API key in AI Customer Service → Credentials.'), { code: 'NO_KEY' });

  /* Put the configured provider first; the other one is a fallback. */
  attempts.sort((a, b) => (a.provider === provider ? -1 : 0) - (b.provider === provider ? -1 : 0));

  const errors = [];
  for (const attempt of attempts) {
    for (let tryNo = 0; tryNo < 2; tryNo++) {
      try {
        const call = attempt.provider === 'openai' ? openaiChat : geminiChat;
        const out = await call({
          apiKey: attempt.key, model: attempt.model, system, messages, temperature, json: true,
        });
        const parsed = parseJsonLoose(out.text);
        if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
          throw Object.assign(new Error('AI returned an unusable response.'), { code: 'BAD_OUTPUT', provider: attempt.provider });
        }
        const allowedStatus = ['requested', 'confirmed', 'rescheduled', 'cancelled', 'completed'];
        return {
          reply: parsed.reply.trim(),
          subject: String(parsed.subject || '').trim(),
          intent: String(parsed.intent || 'general').trim().slice(0, 60),
          escalate: parsed.escalate === true,
          pause_ai: parsed.pause_ai === true,
          suggested_inspection_status: allowedStatus.includes(parsed.suggested_inspection_status) ? parsed.suggested_inspection_status : null,
          provider: out.provider,
          model: out.model,
        };
      } catch (e) {
        errors.push(`${attempt.provider}${e.code ? `/${e.code}` : ''}: ${e.message}`);
        const retryable = !['NO_KEY', 'BAD_KEY', 'SUSPENDED', 'BAD_OUTPUT'].includes(e.code) && tryNo === 0;
        if (!retryable) break;
        await sleep(450 * (tryNo + 1));
      }
    }
  }
  const e = new Error(`AI generation failed. ${errors.join(' · ')}`.slice(0, 600));
  e.code = 'AI_FAILED';
  throw e;
}

const aiService = { geminiChat, openaiChat, generateReply, parseJsonLoose };
export default aiService;
export { aiService };
