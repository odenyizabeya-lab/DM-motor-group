-- ============================================================================
-- MIGRATION 5 (web messaging, optional) - "important" flag for conversations
-- File: 00011_web_messaging.sql
--
-- Run AFTER 00007_ai_customer_service.sql (it already allows web conversations,
-- reply_token access and meta-carried attachments).
-- The messaging room works WITHOUT this migration; it only adds the admin
-- "mark as important" flag. Idempotent and safe to re-run.
-- ============================================================================

alter table public.ai_conversations
  add column if not exists important boolean not null default false;

create index if not exists ai_conversations_important_idx
  on public.ai_conversations (important, updated_at desc) where important = true;

-- ============================================================================
-- End of migration 5.
-- ============================================================================
