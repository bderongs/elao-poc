-- Roadmap L-06 (2026-11-15): Dutch as spoken in the Netherlands ("nl-NL")
-- becomes a test language next to Belgian Dutch ("nl-BE"). Two columns had
-- the six language codes hard-coded in a check constraint:
--   - profiles.last_language (0009): a signed-in candidate's remembered
--     language; with the old check, saving nl-NL fails (logged, not fatal).
--   - conversation_settings.language (0007): the admin's per-language
--     starting-rung override.
-- Only widens the allowed values: no existing row can fail the new checks.

alter table profiles drop constraint if exists profiles_last_language_check;
alter table profiles add constraint profiles_last_language_check
  check (last_language in ('fr', 'en', 'nl-BE', 'nl-NL', 'es', 'it', 'de'));

alter table conversation_settings drop constraint if exists conversation_settings_language_check;
alter table conversation_settings add constraint conversation_settings_language_check
  check (language in ('default', 'fr', 'en', 'nl-BE', 'nl-NL', 'es', 'it', 'de'));
