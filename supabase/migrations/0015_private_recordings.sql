-- Candidates' voice recordings were in a public bucket: anyone holding a
-- link could play them, forever. The bucket is now private. Pages get
-- expiring signed links and server-side replays download with the
-- service-role key (lib/recordings.ts); uploads already use signed upload
-- URLs or the service role, so they don't change.
--
-- Stored audio_url values keep their public-format URLs — the code only reads
-- the file path from them — so no data needs rewriting. Those URLs stop
-- working as direct links once this runs.
--
-- Run AFTER deploying the code that signs recording URLs, or the admin and
-- candidate dashboards show no audio in between.

update storage.buckets set public = false where id = 'recordings';
