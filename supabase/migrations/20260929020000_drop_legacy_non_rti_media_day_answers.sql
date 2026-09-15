-- The legacy non-RTI Media Day system (getNonRtiMediaDay/submitNonRtiMediaDayAnswer in
-- hub.service.ts, the "3 free-text slots" flow) was superseded by the Media Day rebuild
-- (media-day-interview.service.ts, rec_media_day_periods/rec_media_day_challenge_answers/
-- rec_media_day_completions/rec_media_day_commitments) and had zero remaining UI callers on
-- either the site or Discord bot. Only 9 historical rows existed. Dropping the now-orphaned table.
drop table if exists rec_media_day_answers;
