-- Doti: grupos responsáveis por integrante e por convite.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_agency_id_id_key'
  ) then
    alter table public.profiles
      add constraint profiles_agency_id_id_key unique (agency_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.team_invitations'::regclass
      and conname = 'team_invitations_agency_id_id_key'
  ) then
    alter table public.team_invitations
      add constraint team_invitations_agency_id_id_key unique (agency_id, id);
  end if;
end
$$;

create table public.profile_group_responsibilities (
  agency_id uuid not null,
  profile_id uuid not null,
  group_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, group_id),
  foreign key (agency_id, profile_id)
    references public.profiles(agency_id, id) on delete cascade,
  foreign key (agency_id, group_id)
    references public.agency_groups(agency_id, id) on delete cascade
);

create table public.invitation_group_responsibilities (
  agency_id uuid not null,
  invitation_id uuid not null,
  group_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (invitation_id, group_id),
  foreign key (agency_id, invitation_id)
    references public.team_invitations(agency_id, id) on delete cascade,
  foreign key (agency_id, group_id)
    references public.agency_groups(agency_id, id) on delete cascade
);

create index profile_group_responsibilities_agency_group_idx
  on public.profile_group_responsibilities(agency_id, group_id);
create index invitation_group_responsibilities_agency_group_idx
  on public.invitation_group_responsibilities(agency_id, group_id);

alter table public.profile_group_responsibilities enable row level security;
alter table public.invitation_group_responsibilities enable row level security;

create policy "People can view their group responsibilities"
on public.profile_group_responsibilities for select
to authenticated
using (
  agency_id = private.current_agency_id()
  and (
    profile_id = (select auth.uid())
    or private.current_user_role() in ('owner', 'admin')
  )
);

create policy "Managers can view invitation group responsibilities"
on public.invitation_group_responsibilities for select
to authenticated
using (
  agency_id = private.current_agency_id()
  and private.current_user_role() in ('owner', 'admin')
);

grant select on public.profile_group_responsibilities to authenticated;
grant select on public.invitation_group_responsibilities to authenticated;
grant select, insert, update, delete on public.profile_group_responsibilities to service_role;
grant select, insert, update, delete on public.invitation_group_responsibilities to service_role;

-- Existing internal users and pending invitations keep the current behavior:
-- every existing group starts assigned. Owners remain unrestricted by definition.
insert into public.profile_group_responsibilities (agency_id, profile_id, group_id)
select profile.agency_id, profile.id, agency_group.id
from public.profiles profile
join public.agency_groups agency_group on agency_group.agency_id = profile.agency_id
where profile.role in ('admin', 'member', 'viewer')
on conflict do nothing;

insert into public.invitation_group_responsibilities (agency_id, invitation_id, group_id)
select invitation.agency_id, invitation.id, agency_group.id
from public.team_invitations invitation
join public.agency_groups agency_group on agency_group.agency_id = invitation.agency_id
where invitation.status = 'pending'
  and invitation.role in ('admin', 'member', 'viewer')
on conflict do nothing;

create or replace function private.copy_invited_group_responsibilities()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  matching_invitation_id uuid;
begin
  if new.role not in ('admin', 'member', 'viewer') then
    return new;
  end if;

  select invitation.id
  into matching_invitation_id
  from public.team_invitations invitation
  where invitation.agency_id = new.agency_id
    and lower(invitation.email) = lower(new.email)
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  order by invitation.created_at desc
  limit 1;

  if matching_invitation_id is not null then
    insert into public.profile_group_responsibilities (agency_id, profile_id, group_id)
    select new.agency_id, new.id, assignment.group_id
    from public.invitation_group_responsibilities assignment
    where assignment.agency_id = new.agency_id
      and assignment.invitation_id = matching_invitation_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.copy_invited_group_responsibilities() from public, anon, authenticated;

create trigger profiles_copy_invited_group_responsibilities
after insert on public.profiles
for each row execute function private.copy_invited_group_responsibilities();

create or replace function public.current_responsible_group_ids()
returns uuid[]
language sql
stable
security invoker
set search_path = public, private, pg_catalog
as $$
  with context as (
    select private.current_agency_id() as agency_id,
           private.current_user_role() as user_role
  )
  select coalesce(array_agg(agency_group.id order by agency_group.position), '{}'::uuid[])
  from context
  join public.agency_groups agency_group on agency_group.agency_id = context.agency_id
  where context.user_role = 'owner'
    or not exists (
      select 1 from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.agency_id = context.agency_id
    )
    or exists (
      select 1
      from public.profile_group_responsibilities responsibility
      where responsibility.agency_id = context.agency_id
        and responsibility.profile_id = (select auth.uid())
        and responsibility.group_id = agency_group.id
    )
$$;

revoke all on function public.current_responsible_group_ids() from public, anon;
grant execute on function public.current_responsible_group_ids() to authenticated;

create or replace function public.replace_profile_group_responsibilities(
  p_agency_id uuid,
  p_profile_id uuid,
  p_group_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Operação restrita ao serviço administrativo.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where agency_id = p_agency_id and id = p_profile_id
  ) then
    raise exception 'Pessoa não encontrada na agência.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_group_ids, '{}'::uuid[])) requested(group_id)
    where not exists (
      select 1 from public.agency_groups agency_group
      where agency_group.agency_id = p_agency_id
        and agency_group.id = requested.group_id
    )
  ) then
    raise exception 'Um dos grupos não pertence à agência.' using errcode = '23503';
  end if;

  delete from public.profile_group_responsibilities
  where agency_id = p_agency_id and profile_id = p_profile_id;

  insert into public.profile_group_responsibilities (agency_id, profile_id, group_id)
  select p_agency_id, p_profile_id, requested.group_id
  from unnest(coalesce(p_group_ids, '{}'::uuid[])) requested(group_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.replace_profile_group_responsibilities(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.replace_profile_group_responsibilities(uuid, uuid, uuid[]) to service_role;
