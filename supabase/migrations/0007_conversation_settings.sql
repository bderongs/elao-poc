-- Admin-configurable knobs for the live conversation's adaptive-difficulty
-- mechanism (Track J, session 2026-08-12): the starting CEFR rung
-- (app/page.tsx's currentRungRef initial/reset value) and the step size ET
-- (lib/level-assessment.ts) moves per well/struggled verdict. One guaranteed
-- 'default' row applies to every language; an optional per-language row
-- overrides just that language. Seeded values match today's hardcoded
-- behavior exactly ('A2' starting rung, step size 1), so applying this
-- migration changes nothing until an admin edits a row.

create table if not exists conversation_settings (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('default', 'fr', 'en', 'nl-BE', 'es', 'it', 'de')),
  starting_rung text not null check (starting_rung in ('A1', 'A2', 'B1', 'B2', 'C1')),
  step_size smallint not null check (step_size between 1 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (language)
);

alter table conversation_settings enable row level security;

insert into conversation_settings (language, starting_rung, step_size)
  values ('default', 'A2', 1)
  on conflict (language) do nothing;
