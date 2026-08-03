-- Pronunciation lab: uploaded recordings + per-provider comparison, mirroring
-- what 0002_eval_lab.sql already does for text/CEFR evaluation.

-- Distinguishes real conversation sessions from ones created by uploading a
-- standalone audio file in the admin tool (app/admin/upload).
alter table sessions add column if not exists source text not null default 'conversation';

-- One row per (turn, pronunciation-provider) run — the audio-assessment
-- equivalent of session_evaluations, scoped to a single recording instead of
-- a whole session's transcript.
create table if not exists session_turn_evaluations (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references session_turns(id) on delete cascade,
  provider_id text not null,
  result_json jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists session_turn_evaluations_turn_id_idx on session_turn_evaluations (turn_id);
