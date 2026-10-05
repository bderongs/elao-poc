-- Conversation simulator runs (lib/conversation-sim.ts) are now saved like real
-- sessions, flagged with sessions.source = 'simulation' (the column is free
-- text, see 0003). simulation_json holds what only a simulation has: the
-- simulated learner level + persona, the examiner/learner models, the starting
-- rung / step size, an optional batch id (scripts/sim-batch.ts) to group a run
-- for comparison, and per-turn "what the learner heard" / understanding /
-- verdict. Null for every other session.
alter table sessions add column if not exists simulation_json jsonb;
create index if not exists sessions_source_created_idx on sessions (source, created_at desc);
