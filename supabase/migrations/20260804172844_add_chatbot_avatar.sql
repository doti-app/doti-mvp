alter table public.chatbots
add column avatar_path text;

alter table public.chatbots
add constraint chatbots_avatar_path_check check (
  avatar_path is null
  or avatar_path ~ (
    '^' || agency_id::text || '/files/' || id::text || '/[A-Za-z0-9._-]+$'
  )
);

grant select (avatar_path) on public.chatbots to authenticated;
grant update (avatar_path) on public.chatbots to authenticated;
