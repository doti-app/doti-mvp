alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles
  add constraint profiles_avatar_url_check check (
    avatar_url is null
    or avatar_url ~ '^/assets/avatars-users/avatar-(0[1-9]|[12][0-9]|30)\.png$'
    or avatar_url ~ '^profile-avatar:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9]{1,16}$'
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'doti-avatars',
  'doti-avatars',
  false,
  1048576,
  array['image/jpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their avatar object" on storage.objects;
create policy "Users can read their avatar object"
on storage.objects for select to authenticated
using (
  bucket_id = 'doti-avatars'
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/avatar\.jpg$'
  and exists (
    select 1
    from public.profiles viewer
    join public.profiles avatar_owner
      on avatar_owner.agency_id = viewer.agency_id
    where viewer.id = (select auth.uid())
      and viewer.is_active
      and avatar_owner.is_active
      and avatar_owner.id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "Users can upload their avatar object" on storage.objects;
create policy "Users can upload their avatar object"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'doti-avatars'
  and name = (select auth.uid())::text || '/avatar.jpg'
);

drop policy if exists "Users can replace their avatar object" on storage.objects;
create policy "Users can replace their avatar object"
on storage.objects for update to authenticated
using (
  bucket_id = 'doti-avatars'
  and name = (select auth.uid())::text || '/avatar.jpg'
)
with check (
  bucket_id = 'doti-avatars'
  and name = (select auth.uid())::text || '/avatar.jpg'
);

drop policy if exists "Users can remove their avatar object" on storage.objects;
create policy "Users can remove their avatar object"
on storage.objects for delete to authenticated
using (
  bucket_id = 'doti-avatars'
  and name = (select auth.uid())::text || '/avatar.jpg'
);
