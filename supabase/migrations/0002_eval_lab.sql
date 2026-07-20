-- Track 2 (eval lab): re-run a stored session's transcript through multiple
-- LLM providers/prompt versions and compare results, instead of only ever
-- seeing the one score computed live.

create table if not exists session_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  model_id text not null,
  prompt_version text not null,
  result_json jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists session_evaluations_session_id_idx on session_evaluations (session_id);
