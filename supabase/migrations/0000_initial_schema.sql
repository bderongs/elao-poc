-- Baseline schema for a fresh (dev) project, mirroring what the app has been
-- writing to `sessions` since the POC stage. `sessions` was originally
-- created ad hoc via the prod dashboard, not from a migration, so this is
-- reconstructed from the insert calls in code rather than a real schema dump.
-- ASSUMPTION: reconcile this against prod's actual column types before ever
-- running migrations against prod (see the information_schema.columns query
-- requested separately) — if they differ, prod wins and this file should be
-- adjusted to match, not the other way around.

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  language text,
  duration_seconds integer,
  cefr_level text,
  global_score integer,
  scores jsonb,
  transcript jsonb,
  audio_url text,
  azure_scores jsonb
);

-- Public bucket for session/turn recordings — getPublicUrl() (used by both
-- the old browser-insert path and the new /api/sessions route) only produces
-- a working link when the bucket is public.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', true)
on conflict (id) do nothing;
