-- Adaptive session length (Track AC, lib/session-length.ts): the difficulty
-- ladder of a live conversation — one entry per pacing-judge (ET) result:
-- rung asked at, verdict, next rung, answer length — plus where the stop rule
-- would have ended the session ("shadow" mode) or did end it ("adaptive").
-- Until now the rung per turn was only in local log files. Null for sessions
-- saved before this column existed and for upload / Speechace rows.
alter table sessions add column if not exists ladder_json jsonb;
