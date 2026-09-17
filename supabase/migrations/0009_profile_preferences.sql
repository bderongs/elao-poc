-- Persists a signed-in user's last-used language + current CEFR rung so the
-- pre-session welcome screen (app/page.tsx) can offer "Continue in French at
-- B1" instead of always starting from the language picker. Nullable: a
-- brand-new account (or one that has only ever gone through the guest/claim
-- flow) has no stored preference yet, and the picker/admin-default fallback
-- chain (lib/conversation-settings-service.ts) already handles that case.
--
-- last_rung allows all 6 CEFR rungs (unlike conversation_settings.starting_rung,
-- which excludes 'C2' since that governs an admin-set *starting* point) — this
-- column stores a user's actually attained level, which can legitimately be C2.

alter table profiles add column if not exists last_language text
  check (last_language in ('fr', 'en', 'nl-BE', 'es', 'it', 'de'));
alter table profiles add column if not exists last_rung text
  check (last_rung in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
alter table profiles add column if not exists last_used_at timestamptz;

-- RLS on profiles has had zero policies since 0005 (service-role bypasses it
-- regardless, so no existing server code changes behavior). Add minimal
-- self-service read/update so a signed-in user's own preference can be read
-- client-side later without a bespoke API route. Deliberately no policy
-- touches `role` — that stays server-only-writable.
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
