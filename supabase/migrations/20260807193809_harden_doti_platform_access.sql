-- Mantem o contexto de login sob RLS e cobre as novas chaves estrangeiras.

create or replace function public.get_account_context()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with current_account as materialized (
    select (select auth.uid()) as id
  )
  select jsonb_build_object(
    'userId', account.id,
    'email', coalesce(
      s.email,
      p.email,
      nullif((select auth.jwt()) ->> 'email', '')
    ),
    'platform', case when s.id is null then null else jsonb_build_object(
      'id', s.id,
      'email', s.email,
      'fullName', s.full_name,
      'role', s.role,
      'isActive', s.is_active,
      'avatarUrl', s.avatar_url
    ) end,
    'personalAgency', case when p.id is null then null else jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'status', a.status,
      'profileRole', p.role,
      'profileActive', p.is_active
    ) end
  )
  from current_account account
  left join public.platform_staff s
    on s.id = account.id and s.is_active = true
  left join public.profiles p on p.id = account.id
  left join public.agencies a on a.id = p.agency_id
  where account.id is not null
$$;

revoke all on function public.get_account_context()
  from public, anon, authenticated;
grant execute on function public.get_account_context() to authenticated;

create index agencies_archived_by_idx
  on public.agencies(archived_by);
create index platform_staff_created_by_idx
  on public.platform_staff(created_by);
create index platform_staff_invitations_invited_by_idx
  on public.platform_staff_invitations(invited_by);
