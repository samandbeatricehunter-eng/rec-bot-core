-- Box scores, player stats, and recruiting commits now live exclusively in the
-- REC site/app. Clearing these legacy routes also disables old message-capture
-- handlers for panels that may still exist in Discord history.
update public.rec_server_routes
set weekly_submissions_channel_id = null,
    box_scores_channel_id = null,
    updated_at = now()
where weekly_submissions_channel_id is not null
   or box_scores_channel_id is not null;
