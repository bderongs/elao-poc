-- Response timing and light integrity signals
-- (doc/feature-2-response-timing-and-integrity.md, lib/integrity.ts).
--
-- sessions.integrity_json: raw facts recorded by the live page — per question,
-- the latency between the end of the avatar's question and the start of the
-- answer, plus buttons used and technical issues; and each spell outside the
-- test window (type, start, duration, question). Events only, no content.
-- The reviewer summary (none / low / high) is computed from it at read time,
-- so it never touches the score. Null before this column existed, for
-- upload / Speechace / simulation rows, and when the feature is switched off.
alter table sessions add column if not exists integrity_json jsonb;

-- Admin settings for the summary and the on/off switch — a single 'default'
-- row holding a JSON object; lib/integrity.ts's normalizeIntegritySettings
-- fills anything missing with the defaults, so an empty object is valid.
create table if not exists integrity_settings (
  id text primary key default 'default' check (id = 'default'),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table integrity_settings enable row level security;

insert into integrity_settings (id) values ('default') on conflict (id) do nothing;
