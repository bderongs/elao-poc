-- Speechace import: lets an admin paste a competitor placement-report URL and
-- turn it into a session for comparison, mirroring what 0003 did for
-- self-uploaded recordings. `source = 'speechace'` reuses the existing free-text
-- column from 0003 rather than adding an enum.

-- Session-level fluency/pronunciation scores as Speechace reports them
-- (0-9 band scale, not our 0-100 scale) — deliberately no per-turn breakdown.
alter table sessions add column if not exists speechace_scores jsonb;

-- The original report URL, so the admin tool can link back and re-imports
-- of the same report can be detected.
alter table sessions add column if not exists source_url text;
