alter table rec_import_jobs
  add column if not exists rolled_back_at timestamptz,
  add column if not exists rolled_back_by_user_id uuid references rec_users(id);
