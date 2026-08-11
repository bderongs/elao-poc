-- sessions.azure_scores was named for the only provider that ever wrote it
-- (azure-ensemble). M8 Track M made voxtral the live/headline pronunciation
-- provider, so the column now holds voxtral-sourced numbers by default while
-- still being named "azure" — confusing enough that it came up in review.
-- Rename to reflect what it actually is: the session-level pronunciation
-- rollup, regardless of which provider produced it.
alter table sessions rename column azure_scores to pronunciation_scores;
