/* =================================================================
   DM Motor Group — Web Messaging (Customer Communication) engine.
   A real conversation system for the website: persistent storage in the
   ai_conversations / ai_messages tables (channel = 'web'), served by the
   Cloudflare Pages Functions API. AI replies are generated with the same
   hard honesty rules as the email assistant; the assistant introduces
   itself as the DM Motor Group virtual customer assistant.

   Schema (00007, already live): ai_conversations.reply_token / customer_email
   / customer_name / vehicle_id / channel / status / human_takeover / escalated
   / ai_paused / message_count / last_message_at ... ai_messages.meta (jsonb)
   carries attachments and per-message metadata. No schema change required
   for core messaging; the "important" flag needs migration 00011.
   ================================================================= */
import L from './api-lib.js';
import aiCustomer from './ai-customer.js';
import aiService from './ai-service.js';

const err = L.err;
const nowIso = () => new Date().toISOString();

const randToken = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const MIME_IMAGES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME_VIDEOS = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

const lower = (s) => String(s || '').trim().toLowerCase();
const userEmail = (user) => lower(user && user.email);

/* ---------------- conversation creation / lookup ---------------- */

export async function createOrGetConversation(env, { user = null, guestToken = '', vehicleId = null, name = '' }) {
  const vid = +vehicleId || null;
  if (vid) {
    const vr = await L.rest.get(env, 'vehicles', { id: `eq.${vid}`, select: 'id,brand,model,year' }).catch(() => []);
    if (!vr || !vr.length) throw L.err(404, 'Vehicle not found.');
  }
  const email = userEmail(user);
  const token = String(guestToken || '').trim() || randToken();

  if (email) {
    const rows = await L.rest.get(env, 'ai_conversations', {
      customer_email: `eq.${email}`, channel: 'eq.web', vehicle_id: vid ? `eq.${vid}` : 'is.null',
      status: 'neq.closed', select: '*', order: 'updated_at.desc', limit: '1',
    }).catch(() => []);
    const found = rows && rows[0];
    if (found) return { conversation: found, created: false };
  } else {
    const rows = await L.rest.get(env, 'ai_conversations', {
      reply_token: `eq.${token}`, channel: 'eq.web', vehicle_id: vid ? `eq.${vid}` : 'is.null',
      select: '*', order: 'updated_at.desc', limit: '1',
    }).catch(() => []);
    const found = rows && rows[0];
    if (found) return { conversation: found, created: false };
  }

  let vehicle = null;
  if (vid) vehicle = (await L.rest.get(env, 'vehicles', { id: `eq.${vid}`, select: 'brand,model,year' }).catch(() => []))[0] || null;
  const row = {
    channel: 'web',
    reply_token: token,
    customer_email: email || '',
    customer_name: String(name || (user && user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || '').slice(0, 120),
    vehicle_id: vid,
    subject: vehicle ? `Enquiry about ${vehicle.brand} ${vehicle.model} ${vehicle.year}` : 'General enquiry',
    status: 'open',
  };
  const inserted = await L.rest.insert(env, 'ai_conversations', row);
  const conversation = Array.isArray(inserted) ? inserted[0] : inserted;
  return { conversation, created: true };
}

/* verify the caller may access/act on this conversation */
export async function accessConversation(env, { user = null, guestToken = '', conversationId = '' }) {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  const rows = await L.rest.get(env, 'ai_conversations', { id: `eq.${id}`, select: '*' }).catch(() => []);
  const c = rows && rows[0];
  if (!c) return null;
  const email = userEmail(user);
  if (email && lower(c.customer_email) === email) return c;
  const token = String(guestToken || '').trim();
  if (token && c.reply_token && token === c.reply_token) return c;
  return null;
}

/* ---------------- messages ---------------- */
const mapMessage = (m) => ({
  id: m.id,
  direction: m.direction,
  body: m.body_text,
  attachments: (m.meta && m.meta.attachments) || [],
  status: m.status,
  createdAt: m.created_at,
});

export async function listMessages(env, conversationId, { after = 0, limit = 200 } = {}) {
  const rows = await L.rest.get(env, 'ai_messages', {
    conversation_id: `eq.${conversationId}`,
    select: 'id,direction,body_text,status,created_at,meta',
    order: 'created_at.asc,id.asc',
    limit: String(Math.min(+limit || 200, 400)),
  }).catch(() => []);
  return (rows || []).filter((m) => !after || m.id > +after).map(mapMessage);
}

export async function markDeliveredToCustomer(env, conversationId) {
  const rows = await L.rest.get(env, 'ai_messages', {
    conversation_id: `eq.${conversationId}`, direction: 'eq.outbound', status: 'eq.sent', select: 'id',
  }).catch(() => []);
  if (!rows || !rows.length) return 0;
  const ids = rows.map((r) => r.id);
  await L.rest.update(env, 'ai_messages', { id: `in.(${ids.join(',')})` }, { status: 'delivered', updated_at: nowIso() }, true).catch(() => {});
  return ids.length;
}

export async function addCustomerMessage(env, conversation, { text = '', attachments = [] }) {
  const clean = String(text || '').trim().slice(0, 8000);
  const files = (attachments || []).slice(0, 6);
  if (!clean && !files.length) throw L.err(400, 'Please write a message or attach a file.');
  const row = {
    conversation_id: conversation.id,
    direction: 'inbound',
    channel: 'web',
    from_email: conversation.customer_email || '',
    body_text: clean,
    status: 'received',
    meta: files.length ? { attachments: files } : {},
  };
  const inserted = await L.rest.insert(env, 'ai_messages', row);
  const msg = Array.isArray(inserted) ? inserted[0] : inserted;
  await L.rest.update(env, 'ai_conversations', { id: conversation.id }, {
    updated_at: nowIso(), last_direction: 'inbound', last_message_at: nowIso(), message_count: (conversation.message_count || 0) + 1,
  }, true);
  return msg;
}

export async function addDealershipMessage(env, conversationId, { text = '', attachments = [], direction = 'outbound', status = 'sent' }) {
  const clean = String(text || '').trim().slice(0, 8000);
  const files = (attachments || []).slice(0, 6);
  const row = {
    conversation_id: conversationId,
    direction,
    channel: 'web',
    body_text: clean,
    status,
    meta: files.length ? { attachments: files } : {},
  };
  const inserted = await L.rest.insert(env, 'ai_messages', row);
  const msg = Array.isArray(inserted) ? inserted[0] : inserted;
  await L.rest.update(env, 'ai_conversations', { id: conversationId }, {
    updated_at: nowIso(), last_direction: direction === 'internal' ? 'internal' : 'outbound',
    last_message_at: nowIso(),
  }, true);
  return msg;
}

/* ---------------- attachments ---------------- */
export async function saveAttachment(env, { conversationId, mimeType, dataBase64, name }) {
  const cleanName = String(name || 'attachment').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'attachment';
  const isImage = !!MIME_IMAGES[mimeType];
  const isVideo = !!MIME_VIDEOS[mimeType];
  if (!isImage && !isVideo) throw L.err(400, 'Only JPEG, PNG, WebP images and MP4, WebM or MOV videos can be attached.');
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  const b64 = String(dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (b64.length > Math.ceil(maxBytes * 4 / 3) + 8) {
    throw L.err(413, isImage ? 'Images must be 6 MB or smaller.' : 'Videos must be 24 MB or smaller.');
  }
  let bytes;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { throw L.err(400, 'The file could not be read.'); }
  if (!bytes.length) throw L.err(400, 'The file could not be read.');
  if (bytes.length > maxBytes) throw L.err(413, isImage ? 'Images must be 6 MB or smaller.' : 'Videos must be 24 MB or smaller.');

  const ext = isImage ? MIME_IMAGES[mimeType] : MIME_VIDEOS[mimeType];
  const objectPath = `messages/${conversationId}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  try { await L.storageEnsureBucket(env, 'message-media', true, 30); } catch { /* bucket may already exist */ }
  const publicUrl = await L.storageUpload(env, 'message-media', objectPath, bytes, mimeType, false).catch((e) => {
    throw L.err(502, `The attachment could not be stored: ${String((e && e.message) || e).slice(0, 120)}`);
  });
  return { url: publicUrl, kind: isImage ? 'image' : 'video', mime: mimeType, name: cleanName, size: bytes.length };
}

/* ---------------- AI reply (web, honest, transparent) ---------------- */
const WEB_RULES = `You are the DM Motor Group virtual customer assistant — a transparent AI, NOT a human employee, built into the dealership's website. You are helping a customer who is browsing our actual vehicle collection.

HARD RULES — never break these:
1. Only state facts that appear in the VEHICLE DATA block and BUSINESS FACTS block. If a detail is missing, say honestly that you will confirm it with the dealership team — never guess or invent.
2. Price: only quote the listed price exactly. If none is listed, say it is available on request — never invent, discount or negotiate.
3. Availability: only say a vehicle is available if its status is published. Reserved means reserved; sold means sold. Never imply availability when it is not published.
4. Never confirm payments, deposits, inspections or deliveries. Only facts listed in the data may be referenced; otherwise say the team will confirm in writing.
5. Never promise refunds, discounts, insurance, warranties or financing terms.
6. If the customer asks for a human, or the question is sensitive, legal, disputing a payment, or the data does not cover it — set "escalate": true and tell them a human representative will take over personally.
7. Never claim to be a human being. When relevant, you may identify yourself as the DM Motor Group virtual customer assistant.
8. Keep replies SHORT and warm: 40-110 words, one or two short paragraphs, no markdown. Ask one useful follow-up question when natural.
9. If the customer asks to buy or reserve the vehicle, thank them, explain the purchase process (written vehicle order, bank transfer, accounts team confirmation), and ask for their full name, email and preferred contact times.

Return ONLY a JSON object:
{ "reply": "the short message to the customer", "intent": "price|availability|specification|inspection|delivery|payment|purchase|complaint|general", "escalate": false, "pause_ai": false }`;

export async function generateWebAiReply(env, conversation) {
  const cfg = await aiCustomer.loadConfig(env);
  const s = cfg.settings || {};
  const aiOff = !s.enabled;
  if (conversation.ai_paused) return { skipped: true, reason: 'paused' };
  if (conversation.human_takeover) return { skipped: true, reason: 'human_takeover' };
  if (conversation.status === 'closed') return { skipped: true, reason: 'closed' };

  /* AI not configured/enabled: the customer is NEVER left with silence —
   * an honest holding message is stored and the team is flagged instead. */
  if (aiOff) {
    const recent = await L.rest.get(env, 'ai_messages', {
      conversation_id: `eq.${conversation.id}`, direction: 'eq.outbound', select: 'id', order: 'id.desc', limit: '1',
    }).catch(() => []);
    const HOLDING = 'Thank you for contacting DM Motor Group. Our dealership team has received your message and will confirm the details with you here personally — please allow us a little time during showroom hours.';
    if (recent && recent.length) {
      const last = await L.rest.get(env, 'ai_messages', { id: `eq.${recent[0].id}`, select: 'body_text,created_at' }).catch(() => []);
      if (last && last[0] && last[0].body_text === HOLDING && (Date.now() - Date.parse(last[0].created_at || 0)) < 15 * 60e3) {
        return { skipped: true, reason: 'holding_message_recent' };
      }
    }
    const msg = await addDealershipMessage(env, conversation.id, {
      text: HOLDING,
      direction: 'outbound', status: 'sent',
    });
    await L.rest.update(env, 'ai_conversations', { id: conversation.id }, {
      escalated: true, escalation_reason: 'ai_disabled', updated_at: nowIso(), message_count: (conversation.message_count || 0) + 1,
    }, true).catch(() => {});
    const vehRows = conversation.vehicle_id
      ? await L.rest.get(env, 'vehicles', { id: `eq.${conversation.vehicle_id}`, select: 'brand,model,year' }).catch(() => [])
      : [];
    const veh = vehRows && vehRows[0] ? `${vehRows[0].brand} ${vehRows[0].model} ${vehRows[0].year}` : 'a vehicle enquiry';
    await aiCustomer.alertAdmin(env, cfg, `Unanswered website conversation — ${conversation.customer_name || conversation.customer_email || 'website visitor'}`,
      `The AI assistant is disabled (no provider key), so a holding message was sent but the customer still needs a human reply.\n\nCustomer: ${conversation.customer_name || 'not provided'}${conversation.customer_email ? ' <' + conversation.customer_email + '>' : ''}\nEnquiry: ${veh}\n\nPlease open the Customer Messages page in the admin dashboard to reply.`).catch(() => {});
    return { reply: msg.body_text, messageId: msg.id, escalated: true, fallback: true, reason: 'ai_disabled' };
  }

  const [vehicle, history] = await Promise.all([
    aiCustomer.getVehicle(env, conversation.vehicle_id),
    aiCustomer.conversationHistory(env, conversation.id, 12),
  ]);
  const p = cfg.public || {};
  const context = [
    'BUSINESS FACTS',
    `Dealership: ${(p.company_name || s.business_name || 'DM Motor Group')}`,
    `Customer: ${conversation.customer_name || 'not provided'} <${conversation.customer_email || 'not provided'}>`,
    'Channel: DM Motor Group website messaging (no phone calls, no email)',
    `Showroom: ${p.address_primary || p.address || 'Dubai, United Arab Emirates'}`,
    `Hours: ${p.hours || 'Monday to Saturday, 9:00-19:00'}`,
    `Payment policy: ${p.payment_info || 'Payments are made through verified dealership bank details, confirmed in writing by the accounts team.'}`,
    '',
    'VEHICLE DATA',
    aiCustomer.vehicleFacts(vehicle),
  ].join('\n');

  const prompt = `${context}\n\nCONVERSATION HISTORY (oldest first):\n${history.length ? history.map((m) => m.text).join('\n\n') : '(no previous messages)'}\n\nTASK: Write the next short website message to this customer. Only verified data; if unsure, say the dealership team will confirm.`;

  const decision = await aiService.generateReply({
    geminiKey: cfg.geminiKey,
    openaiKey: cfg.openaiKey,
    provider: s.ai_provider || 'gemini',
    geminiModel: s.gemini_model,
    openaiModel: s.openai_model,
    system: WEB_RULES,
    messages: [{ role: 'user', text: prompt }],
    temperature: 0.55,
  }).catch((e) => ({ fallbackError: String((e && e.message) || e).slice(0, 200) }));

  let reply;
  let escalate = false;
  let intent = 'general';
  if (decision.fallbackError) {
    reply = 'Thank you for your message. Let me confirm that with our dealership team so we can give you accurate information — someone will follow up here shortly.';
    escalate = true;
  } else {
    reply = String(decision.reply || '').trim();
    if (!reply) { reply = 'Thank you for your message. Our dealership team will confirm the details with you shortly.'; escalate = true; }
    escalate = !!decision.escalate;
    intent = String(decision.intent || 'general');
  }

  const msg = await addDealershipMessage(env, conversation.id, { text: reply, direction: 'outbound', status: 'sent' });
  const patch = { updated_at: nowIso(), message_count: (conversation.message_count || 0) + 1 };
  if (decision.pause_ai) patch.ai_paused = true;
  if (escalate) { patch.escalated = true; patch.escalation_reason = intent.slice(0, 60); }
  await L.rest.update(env, 'ai_conversations', { id: conversation.id }, patch, true).catch(() => {});
  if (escalate) {
    await aiCustomer.alertAdmin(env, cfg, `Human follow-up needed — ${conversation.customer_name || conversation.customer_email || 'website visitor'}`,
      `A website conversation has been escalated to a human.\n\nCustomer: ${conversation.customer_name || 'not provided'}${conversation.customer_email ? ' <' + conversation.customer_email + '>' : ''}\nVehicle: ${aiCustomer.vehicleLabel(vehicle)}\nIntent: ${intent}\n\nPlease open the Customer Messages page in the admin dashboard to take over.`).catch(() => {});
  }
  return { reply, messageId: msg.id, escalated: escalate, aiPaused: !!decision.pause_ai, fallback: !!decision.fallbackError };
}

/* ---------------- admin helpers ---------------- */
export async function adminListConversations(env, { status = '', limit = 50 } = {}) {
  const q = {
    channel: 'eq.web', select: '*', order: 'updated_at.desc', limit: String(Math.min(+limit || 50, 100)),
  };
  if (status) q.status = `eq.${status}`;
  const rows = await L.rest.get(env, 'ai_conversations', q).catch(() => []);
  const ids = [...new Set((rows || []).map((r) => r.vehicle_id).filter(Boolean))];
  const vehicles = ids.length
    ? await L.rest.get(env, 'vehicles', { id: `in.(${ids.join(',')})`, select: 'id,brand,model,year,slug' }).catch(() => [])
    : [];
  const vmap = new Map((vehicles || []).map((v) => [v.id, v]));
  return (rows || []).map((c) => {
    const metaImportant = !!(c.meta && c.meta.important);
    return {
      id: c.id,
      customerName: c.customer_name || 'Website visitor',
      customerEmail: c.customer_email || '',
      vehicleId: c.vehicle_id,
      vehicle: vmap.get(c.vehicle_id) || null,
      status: c.status,
      important: c.important !== undefined ? !!c.important : metaImportant,
      humanTakeover: !!c.human_takeover,
      escalated: !!c.escalated,
      escalationReason: c.escalation_reason || '',
      aiPaused: !!c.ai_paused,
      messageCount: c.message_count || 0,
      lastMessageAt: c.last_message_at,
      createdAt: c.created_at,
    };
  });
}

export default {
  createOrGetConversation, accessConversation, listMessages, markDeliveredToCustomer,
  addCustomerMessage, addDealershipMessage, saveAttachment, generateWebAiReply,
  adminListConversations, randToken,
};
