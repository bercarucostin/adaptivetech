-- Supabase Storage buckets used by Flowrise.
-- Storage system tables (storage.objects, storage.buckets, etc.) are managed by Supabase; do not recreate them.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-files', 'chat-files', false, 26214400, NULL)
ON CONFLICT (id) DO UPDATE SET
  name=excluded.name, public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('work-order-files', 'work-order-files', false, 52428800, NULL)
ON CONFLICT (id) DO UPDATE SET
  name=excluded.name, public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
