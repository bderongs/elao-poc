-- Track 1 (backend core): full evaluation persistence + per-turn replay data.
--
-- Assumes sessions.id is uuid (Supabase's default when a table is created via
-- the dashboard). If your `sessions` table uses a bigint/identity id instead,
-- change `session_id uuid` below to match before running this.

-- Full CEFR evaluation JSON (strengths, areas_for_improvement, notable_errors,
-- summary, confidence, candidate...) — previously only the 3 numeric
-- `dimensions` were kept in `scores`; the reasoning behind the score was
-- discarded once the browser tab closed.
alter table sessions add column if not exists evaluation_json jsonb;

-- One row per conversation turn, so the admin tool can list/replay a single
-- answer's audio and see the pronunciation verdict that was actually applied
-- to it, instead of only a whole-session recording plus a session-level blob.
create table if not exists session_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  turn_index integer not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  audio_url text,
  pronunciation_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists session_turns_session_id_idx on session_turns (session_id);
