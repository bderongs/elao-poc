-- Interface language of each session (roadmap L-03): the language the
-- candidate saw the screens in — fr, en, nl, es, it, de (lib/ui-strings.ts),
-- independent of `language`, the language being tested. Decides which
-- translation of the feedback the candidate is shown (L-04).
-- Additive only (the database is shared between dev and prod). Written
-- best-effort by lib/sessions-service.ts, so the app keeps working if this
-- has not been run yet. Null for sessions before this migration (= French).
alter table sessions add column if not exists ui_language text;
