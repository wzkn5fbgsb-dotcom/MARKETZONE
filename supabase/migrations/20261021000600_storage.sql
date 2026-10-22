-- =====================================================================
-- MARKETXONE · 0600 · Almacenamiento de imágenes (Supabase Storage)
-- Cada usuario solo puede escribir dentro de su carpeta: <auth.uid()>/...
-- Los buckets son públicos para lectura (imágenes de catálogo).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('media',          'media',          true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

create policy mz_storage_read_own on storage.objects for select to authenticated
  using (bucket_id in ('product-images', 'media') and (storage.foldername(name))[1] = auth.uid()::text);
create policy mz_storage_insert_own on storage.objects for insert to authenticated
  with check (bucket_id in ('product-images', 'media') and (storage.foldername(name))[1] = auth.uid()::text);
create policy mz_storage_update_own on storage.objects for update to authenticated
  using (bucket_id in ('product-images', 'media') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('product-images', 'media') and (storage.foldername(name))[1] = auth.uid()::text);
create policy mz_storage_delete_own on storage.objects for delete to authenticated
  using (bucket_id in ('product-images', 'media') and (storage.foldername(name))[1] = auth.uid()::text);
