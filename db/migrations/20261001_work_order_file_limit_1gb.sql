-- Supabase Pro: allow work-order attachments up to 1 GB (1,024 MB).
-- Before applying, set Storage > Settings > Global file size limit to at
-- least 1,024 MB. That project setting cannot be changed by this SQL.
-- Deploy the updated authorize-work-order-file Edge Function and frontend
-- alongside this migration. Existing file paths and permissions are unchanged.
UPDATE storage.buckets
SET file_size_limit = 1073741824
WHERE id = 'work-order-files';
