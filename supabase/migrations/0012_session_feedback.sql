-- Optional post-assessment satisfaction survey (components/SatisfactionModal.tsx,
-- enabled with NEXT_PUBLIC_SATISFACTION_MODAL=1): three 1-10 ratings plus an
-- optional comment. One row per session — resubmitting overwrites.
create table if not exists session_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions(id) on delete cascade,
  experience_rating smallint not null check (experience_rating between 1 and 10),
  questions_relevance smallint not null check (questions_relevance between 1 and 10),
  grade_relevance smallint not null check (grade_relevance between 1 and 10),
  comment text,
  created_at timestamptz not null default now()
);

-- Service-role only, like the other tables: RLS on, no policies.
alter table session_feedback enable row level security;
