# AI Customer Service — setup and operation

The assistant runs entirely on your existing stack:

```
Customer form / inbound email
        │
        ▼
Cloudflare Pages API  ──►  Supabase (conversations, messages, inspections, jobs)
        ▲                              │
        │                              ▼
Cloudflare Worker cron (1 min) ──► AI reply (Gemini free tier, OpenAI fallback)
                                       │
                                       ▼
                              Resend (real email delivery)
                                       │
                              inbound webhook ──► back to step 1
```

Nothing depends on your browser or phone being online. The cron Worker
`dm-motor-group-ai-cron` calls `/api/internal/ai/tick` every minute with a
shared secret.

## What is automatic

| Event | Email sent |
|---|---|
| New website enquiry | Personal reply from the assistant |
| Inspection requested | Acknowledgement that it is **requested**, not confirmed |
| Inspection confirmed / rescheduled / cancelled / completed | Update email, only after an admin changes the status |
| Vehicle price changed | Email to every open conversation about that vehicle |
| Vehicle availability changed | Email to every open conversation about that vehicle |
| Order status changed | Email only for a real order record |
| Customer replies by email | AI reads it and answers |
| No reply for the configured period | Polite follow-up |
| Sensitive / complaint / payment dispute | AI escalates to a human and emails the admin |

Every outbound email is saved in the admin dashboard with its provider id and
delivery status.

## 1. Apply the database migration

Run `supabase/migrations/00006_vehicle_ai_fields.sql` and
`supabase/migrations/00007_ai_customer_service.sql` in the Supabase SQL Editor
(project `gevxgqdevaanmxqzverv`).

The AI tables have RLS enabled and **no policies**, so only the service-role
key used by the Worker can read them. API keys are never stored in the public
`settings` table.

## 2. Create the free email account (Resend)

1. Sign up at <https://resend.com> (free: 3,000 emails/month, 100/day).
2. Add the domain `dmmotorgroup.com` and create the DNS records Resend shows
   (SPF + DKIM). Wait for “Verified”.
3. Create an API key with sending permission.
4. Create a **receiving** domain, e.g. `inbound.dmmotorgroup.com`.
   Add the MX record Resend gives you for `inbound` in Namecheap.
   Do not put the MX on the root domain.
5. Add a webhook:
   - URL: `https://dmmotorgroup.com/api/webhooks/resend`
   - Event: `email.received` (also enable `email.delivered`, `email.bounced`,
     `email.failed` for status tracking)
   - Copy the signing secret (`whsec_…`).

## 3. Create the free AI key (Gemini)

1. Open <https://aistudio.google.com/apikey> with the project that owns the key.
2. Create an API key. The free tier currently covers Gemini Flash text models.
   Free-tier content may be used by Google to improve its products — this is
   disclosed here so the choice is explicit.
3. If the project is suspended (`403 CONSUMER_SUSPENDED`), create a new Google
   Cloud project or use an OpenAI key as the fallback.

## 4. Enter everything in the dashboard

Open **Admin → AI Customer Service**.

Credentials:
- Google Gemini API key
- Resend API key
- Resend webhook signing secret

Settings:
- Sender email: e.g. `hello@dmmotorgroup.com` (must be on the verified domain)
- Inbound reply domain: `inbound.dmmotorgroup.com`
- Admin alert email: where escalations and inspection requests go
- Tone, signature, custom instructions
- Daily email cap (default 100, matching Resend's free tier)
- Reply delay and follow-up period

Then press **Activate assistant**, **Test AI reply**, and **Send test email**.

Reply to the test email from your own mailbox. It should appear under
**Conversations** within a minute, and the assistant should answer.

## 5. Cron heartbeat

The Worker is already deployed:

```
name: dm-motor-group-ai-cron
schedule: * * * * *
```

Its `AI_INTERNAL_KEY` secret must match the Pages environment variable of the
same name. Both are already configured. If you rotate the key, update both.

Manual run: `GET https://dm-motor-group-ai-cron.motorgroupdm.workers.dev/?key=<key>`
(or use **Run automation now** in the dashboard).

## Safety rules enforced in the prompt and code

- Vehicle facts come only from the database row attached to the conversation.
- `price = 0` is always described as “price on request”.
- Availability comes from the real vehicle status (`published`, `reserved`, `sold`).
- An inspection is never described as confirmed unless its status is `confirmed`.
- Payments are never confirmed without a verified order record.
- Delivery dates are never promised.
- No discounts, negotiations or binding price agreements.
- Complaints, payment disputes and unknown questions are escalated to a human.
- No phone number is ever requested; all communication is by email.

## Failure handling

- Every email is a durable job in `ai_jobs`.
- Transient failures retry with exponential backoff (30 s → 1 h, six attempts).
- A daily-cap breach is deferred, not failed.
- Failed jobs are visible in the dashboard and can be retried.
- Claiming uses `SELECT … FOR UPDATE SKIP LOCKED`, so two ticks never send the
  same job twice.
- Resend sends use an idempotency key derived from the stored message row.

## Troubleshooting

| Symptom | Check |
|---|---|
| “Database setup required” | Migration 00007 not applied |
| Jobs fail with “No AI provider key” | Gemini/OpenAI key missing or suspended |
| Jobs fail with “Sender email is not configured” | Settings → Sender email |
| Test email fails | Resend key, verified domain, daily cap |
| Replies do not arrive | Receiving domain MX, Resend webhook secret, webhook event `email.received` |
| Emails arrive but AI does not answer | Assistant disabled, conversation paused, or human takeover |
| “Invalid webhook signature” | Webhook secret does not match the Resend endpoint |
