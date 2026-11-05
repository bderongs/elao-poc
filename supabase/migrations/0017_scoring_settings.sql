-- Admin-editable score → level cut-offs (lib/cefr-score.ts's LevelFloors).
-- A single 'default' row; lib/scoring-settings-service.ts falls back to
-- DEFAULT_LEVEL_FLOORS when the row is empty or the table is missing. Levels
-- are computed when a page is viewed, so a change also relabels past sessions.
create table if not exists scoring_settings (
  id text primary key default 'default' check (id = 'default'),
  level_floors jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table scoring_settings enable row level security;

insert into scoring_settings (id) values ('default') on conflict (id) do nothing;
