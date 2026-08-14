-- Per-session snapshot of which provider/model each capability (STT, TTS,
-- ET, EO, CEFR-eval) used — see lib/system-config.ts. Nullable: historical
-- sessions predate this column and have no snapshot.
alter table sessions add column if not exists providers_json jsonb;
