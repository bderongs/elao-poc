-- Live conversation sessions used to be written once, at the very end — a
-- tab closed mid-conversation (or a failed final save) left no trace. The
-- row is now created at the first answer (status 'in_progress') and updated
-- after every answer; the end-of-session save finalises it ('completed').
-- "Not finished" in the admin list = in_progress with no recent activity,
-- computed at read time (no scheduled job).
-- Every pre-existing row, and every upload / Speechace-import row, is a
-- finished session: the default keeps them 'completed'.
alter table sessions add column if not exists status text not null default 'completed'
  check (status in ('in_progress', 'completed'));
alter table sessions add column if not exists last_activity_at timestamptz not null default now();
update sessions set last_activity_at = created_at where last_activity_at > created_at;
