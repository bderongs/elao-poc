-- Test profiles (roadmap phase 3, P-01 to P-03): a client's own questions
-- (Safran first), asked during the conversation next to the standard bank.
-- Edited in /admin/profiles; read by the examiner each turn
-- (lib/test-profiles.ts, lib/examiner-prompt.ts).
--
-- A question has a level RANGE, not one level: it can be asked whenever the
-- conversation is at a level inside it. Each profile asks at least
-- min_questions of them per test; when the end of the test nears and some
-- are missing, the one whose range is closest to the current level is asked.
--
-- Additive only (the database is shared between dev and prod). Server-side
-- only: RLS on, no policies — the service role reads and writes.

create table if not exists test_profiles (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  -- The tested language the profile applies to; a test in another language ignores it.
  language text not null default 'en' check (language in ('fr', 'en', 'nl-BE', 'nl-NL', 'es', 'it', 'de')),
  min_questions integer not null default 3 check (min_questions between 0 and 12),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists test_profile_questions (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references test_profiles(id) on delete cascade,
  position integer not null default 0,
  text text not null check (length(trim(text)) > 0),
  -- Easier wording: asked when the candidate says they didn't understand.
  simpler text,
  min_level text not null check (min_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  max_level text not null check (max_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists test_profile_questions_profile_idx on test_profile_questions (profile_id, position);

alter table test_profiles enable row level security;
alter table test_profile_questions enable row level security;

-- The profile a session was taken with (?profile= on the test link, later the API).
alter table sessions add column if not exists test_profile text;

-- Safran: 12 questions from Michel (2026-11-16), English tests. Ranges are a
-- first proposal (Baptiste approved the principle), editable in the admin.
insert into test_profiles (id, name, language, min_questions)
values ('safran', 'Safran', 'en', 3)
on conflict (id) do nothing;

insert into test_profile_questions (profile_id, position, text, min_level, max_level)
select 'safran', q.position, q.text, q.min_level, q.max_level
from (values
  (1,  'What do you know about Safran?', 'A2', 'B2'),
  (2,  'Why would you like to work for Safran? And what would a good first year at Safran look like for you?', 'B1', 'C1'),
  (3,  'What interests you most about the aerospace industry?', 'B1', 'B2'),
  (4,  'How would you explain Safran''s business to someone who does not know the company?', 'B2', 'C1'),
  (5,  'What skills would you bring to Safran? Which one would be most useful in the job you''re applying for, and why?', 'B1', 'C1'),
  (6,  'What do you expect from an international company such as Safran?', 'B1', 'B2'),
  (7,  'Tell me about a situation where you had to solve a difficult problem at work or during your studies. What did you do?', 'B1', 'B2'),
  (8,  'What do you think are the main challenges facing the aerospace industry today?', 'B2', 'C1'),
  (9,  'What are the advantages and challenges of working in multicultural teams?', 'B2', 'C1'),
  (10, 'If you had to convince a talented candidate to join Safran, what would you tell them?', 'B2', 'C1'),
  (11, 'In your opinion, what is Safran''s most innovative product?', 'B1', 'B2'),
  (12, 'Imagine you start at Safran next month. What would you do in your first weeks to fit in?', 'B1', 'B2')
) as q(position, text, min_level, max_level)
where not exists (select 1 from test_profile_questions where profile_id = 'safran');
