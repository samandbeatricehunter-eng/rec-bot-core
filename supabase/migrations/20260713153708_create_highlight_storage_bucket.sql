insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rec-highlights',
  'rec-highlights',
  true,
  104857600,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
