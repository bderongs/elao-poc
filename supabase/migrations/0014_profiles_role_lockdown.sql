-- Closes a privilege escalation opened by 0009: the "profiles_update_own"
-- policy let any signed-in user update their own profiles row with the
-- public anon key, and RLS policies are row-level, not column-level, so that
-- included `role` — `supabase.from('profiles').update({ role: 'admin' })`
-- from the browser console made any candidate an admin.
--
-- Nothing uses that policy: every profiles write goes through the
-- service-role client (lib/supabase-server.ts), which bypasses RLS. So it is
-- dropped, and UPDATE on the table is revoked from the browser roles as a
-- second line of defence should a policy ever be re-added. The read-own
-- policy stays (harmless, and still unused).
--
-- Granting admin rights: see README.md, "Comptes administrateurs".

drop policy if exists "profiles_update_own" on profiles;

revoke insert, update, delete, truncate on profiles from anon, authenticated;
