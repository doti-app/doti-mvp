-- Doti: portal seguro de aprovacoes para clientes das agencias.

alter table public.profiles
  add column client_id uuid;

alter table public.team_invitations
  add column client_id uuid;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'admin', 'member', 'viewer', 'client'));

alter table public.team_invitations drop constraint if exists team_invitations_role_check;
alter table public.team_invitations
  add constraint team_invitations_role_check
  check (role in ('admin', 'member', 'viewer', 'client'));

alter table public.profiles
  add constraint profiles_client_assignment_check
  check (
    (role = 'client' and client_id is not null)
    or (role <> 'client' and client_id is null)
  );

alter table public.team_invitations
  add constraint team_invitations_client_assignment_check
  check (
    (role = 'client' and client_id is not null)
    or (role <> 'client' and client_id is null)
  );

alter table public.profiles
  add constraint profiles_client_agency_fk
  foreign key (agency_id, client_id)
  references public.clients(agency_id, id)
  on delete restrict;

alter table public.team_invitations
  add constraint team_invitations_client_agency_fk
  foreign key (agency_id, client_id)
  references public.clients(agency_id, id)
  on delete restrict;

create or replace function private.normalize_profile_client_assignment()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.role <> 'client' then
    new.client_id := null;
  end if;
  return new;
end;
$$;

create trigger profiles_normalize_client_assignment
before insert or update of role, client_id on public.profiles
for each row execute function private.normalize_profile_client_assignment();

revoke all on function private.normalize_profile_client_assignment() from public, anon, authenticated;

create index profiles_client_idx
  on public.profiles(agency_id, client_id)
  where client_id is not null;
create index team_invitations_client_idx
  on public.team_invitations(agency_id, client_id)
  where client_id is not null;

alter table public.agency_groups
  add column is_client_group boolean not null default false;

with candidates as (
  select
    id,
    row_number() over (
      partition by agency_id
      order by
        case
          when lower(trim(name)) in ('cliente / atendimento', 'cliente/atendimento', 'cliente') then 0
          else 1
        end,
        position,
        created_at,
        id
    ) as candidate_position
  from public.agency_groups
  where lower(name) like '%cliente%'
)
update public.agency_groups group_row
set is_client_group = true
from candidates
where candidates.id = group_row.id
  and candidates.candidate_position = 1;

create unique index agency_groups_one_client_group_idx
  on public.agency_groups(agency_id)
  where is_client_group;

create or replace function private.default_client_group_on_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.is_client_group = false
     and lower(trim(new.name)) in ('cliente / atendimento', 'cliente/atendimento', 'cliente')
     and not exists (
       select 1 from public.agency_groups existing
       where existing.agency_id = new.agency_id
         and existing.is_client_group
     ) then
    new.is_client_group := true;
  end if;
  return new;
end;
$$;

create trigger agency_groups_default_client_group
before insert on public.agency_groups
for each row execute function private.default_client_group_on_insert();

create or replace function private.validate_client_group_position()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.position = 0 and exists (
    select 1 from public.agency_groups group_row
    where group_row.agency_id = new.agency_id
      and group_row.id = new.group_id
      and group_row.is_client_group
  ) then
    raise exception 'A primeira etapa de um fluxo não pode ser atribuída ao grupo do cliente.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger workflow_steps_validate_client_group_position
before insert or update of group_id, position on public.workflow_steps
for each row execute function private.validate_client_group_position();

create or replace function private.protect_client_group_configuration()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and old.is_client_group then
    raise exception 'Defina outro grupo do cliente antes de excluir este grupo.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and new.is_client_group
     and new.is_client_group is distinct from old.is_client_group
     and exists (
       select 1 from public.workflow_steps step_row
       where step_row.agency_id = new.agency_id
         and step_row.group_id = new.id
         and step_row.position = 0
     ) then
    raise exception 'Este grupo é usado como primeira etapa e não pode ser o grupo do cliente.'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger agency_groups_protect_client_group
before update of is_client_group or delete on public.agency_groups
for each row execute function private.protect_client_group_configuration();

revoke all on function private.default_client_group_on_insert() from public, anon, authenticated;
revoke all on function private.validate_client_group_position() from public, anon, authenticated;
revoke all on function private.protect_client_group_configuration() from public, anon, authenticated;

create table public.client_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null,
  project_id uuid not null,
  deliverable_id uuid not null,
  deliverable_step_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  comment text not null default '' check (char_length(comment) <= 2000),
  from_step_position integer not null check (from_step_position >= 0),
  to_step_position integer check (to_step_position is null or to_step_position >= 0),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_by_name text not null check (char_length(decided_by_name) between 1 and 120),
  decided_by_role text not null check (decided_by_role in ('owner', 'admin', 'client')),
  decided_at timestamptz not null default now(),
  foreign key (agency_id, client_id)
    references public.clients(agency_id, id) on delete restrict,
  foreign key (agency_id, project_id)
    references public.projects(agency_id, id) on delete cascade,
  foreign key (agency_id, deliverable_id)
    references public.deliverables(agency_id, id) on delete cascade,
  foreign key (agency_id, deliverable_step_id)
    references public.deliverable_steps(agency_id, id) on delete restrict
);

create index client_approval_decisions_deliverable_idx
  on public.client_approval_decisions(agency_id, deliverable_id, decided_at desc);
create index client_approval_decisions_client_idx
  on public.client_approval_decisions(agency_id, client_id, decided_at desc);
create index client_approval_decisions_actor_idx
  on public.client_approval_decisions(decided_by, decided_at desc);

create or replace function private.prevent_client_approval_decision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Decisões de aprovação são registros imutáveis.'
    using errcode = '55000';
end;
$$;

create trigger client_approval_decisions_are_immutable
before update or delete on public.client_approval_decisions
for each row execute function private.prevent_client_approval_decision_mutation();

revoke all on function private.prevent_client_approval_decision_mutation() from public, anon, authenticated;

alter table public.client_approval_decisions enable row level security;

create or replace function private.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $$
  select profile.client_id
  from public.profiles profile
  join public.agencies agency
    on agency.id = profile.agency_id
   and agency.status = 'active'
  where profile.id = (select auth.uid())
    and profile.is_active
    and profile.role = 'client'
    and private.current_user_role() = 'client'
$$;

revoke all on function private.current_client_id() from public, anon, authenticated;
grant execute on function private.current_client_id() to authenticated;

drop policy if exists "Members can view agency profiles" on public.profiles;
create policy "Agency staff or profile owner can view profiles"
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or (
    agency_id = private.current_agency_id()
    and private.current_user_role() in ('owner', 'admin', 'member', 'viewer')
  )
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'agency_operation_state', 'agency_groups', 'workflows', 'workflow_steps',
    'clients', 'client_workspace_blocks', 'projects', 'deliverables',
    'deliverable_steps', 'step_tasks', 'deliverable_links', 'files',
    'activity_events', 'legacy_imports'
  ]
  loop
    execute format('drop policy if exists "Agency members can read" on public.%I', table_name);
    execute format(
      'create policy "Agency members can read" on public.%I for select to authenticated using (agency_id = private.current_agency_id() and private.current_user_role() in (''owner'', ''admin'', ''member'', ''viewer''))',
      table_name
    );
  end loop;
end
$$;

create policy "Authorized users can read approval decisions"
on public.client_approval_decisions for select
to authenticated
using (
  agency_id = private.current_agency_id()
  and (
    private.current_user_role() in ('owner', 'admin', 'member', 'viewer')
    or (
      private.current_user_role() = 'client'
      and client_id = private.current_client_id()
    )
  )
);

grant select on public.client_approval_decisions to authenticated;
grant select, insert on public.client_approval_decisions to service_role;

create or replace function private.client_can_download_doti_file(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $$
  select
    (select auth.uid()) is not null
    and private.current_user_role() = 'client'
    and exists (
      select 1
      from public.files file_row
      join public.deliverables deliverable
        on deliverable.agency_id = file_row.agency_id
       and deliverable.id = file_row.deliverable_id
      join public.projects project
        on project.agency_id = deliverable.agency_id
       and project.id = deliverable.project_id
      where file_row.agency_id = private.current_agency_id()
        and file_row.storage_path = p_storage_path
        and project.client_id = private.current_client_id()
    )
$$;

revoke all on function private.client_can_download_doti_file(text) from public, anon, authenticated;
grant execute on function private.client_can_download_doti_file(text) to authenticated;

drop policy if exists "Agency members can download Doti files" on storage.objects;
create policy "Authorized users can download Doti files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'doti-files'
  and (
    (
      private.current_user_role() in ('owner', 'admin', 'member', 'viewer')
      and (storage.foldername(name))[1] = private.current_agency_id()::text
    )
    or private.client_can_download_doti_file(name)
  )
);

create or replace function private.configure_client_group_internal(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_agency_id uuid := private.current_agency_id();
  v_role text := private.current_user_role();
  v_group public.agency_groups%rowtype;
begin
  if (select auth.uid()) is null
     or v_agency_id is null
     or v_role not in ('owner', 'admin') then
    raise exception 'Você não tem permissão para definir o grupo do cliente.'
      using errcode = '42501';
  end if;

  select * into v_group
  from public.agency_groups
  where agency_id = v_agency_id and id = p_group_id
  for update;

  if v_group.id is null then
    raise exception 'Grupo não encontrado.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.workflow_steps step_row
    where step_row.agency_id = v_agency_id
      and step_row.group_id = p_group_id
      and step_row.position = 0
  ) then
    raise exception 'Este grupo é usado como primeira etapa e não pode ser o grupo do cliente.'
      using errcode = '23514';
  end if;

  update public.agency_groups
  set is_client_group = false
  where agency_id = v_agency_id and is_client_group and id <> p_group_id;

  update public.agency_groups
  set is_client_group = true
  where agency_id = v_agency_id and id = p_group_id;

  update public.agency_operation_state
  set revision = revision + 1
  where agency_id = v_agency_id;

  return jsonb_build_object('groupId', p_group_id, 'configured', true);
end;
$$;

create or replace function public.configure_client_group(p_group_id uuid)
returns jsonb
language sql
security invoker
set search_path = private, pg_catalog
as $$
  select private.configure_client_group_internal(p_group_id)
$$;

revoke all on function private.configure_client_group_internal(uuid) from public, anon, authenticated;
revoke all on function public.configure_client_group(uuid) from public, anon, authenticated;
grant execute on function private.configure_client_group_internal(uuid) to authenticated;
grant execute on function public.configure_client_group(uuid) to authenticated;

create or replace function private.load_client_approval_queue_internal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_agency_id uuid := private.current_agency_id();
  v_role text := private.current_user_role();
  v_client_id uuid := private.current_client_id();
  v_items jsonb;
begin
  if v_user_id is null
     or v_agency_id is null
     or v_role not in ('owner', 'admin', 'member', 'viewer', 'client') then
    raise exception 'Você não tem acesso às aprovações desta agência.'
      using errcode = '42501';
  end if;

  if v_role = 'client' and v_client_id is null then
    raise exception 'Este acesso de cliente não possui um cliente vinculado.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'due', item ->> 'projectName', item ->> 'deliverableName'), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', deliverable.id,
      'clientId', client.id,
      'clientName', client.name,
      'projectId', project.id,
      'projectName', project.name,
      'projectDue', project.due_date,
      'deliverableId', deliverable.id,
      'deliverableName', deliverable.name,
      'category', deliverable.category,
      'color', deliverable.color,
      'stepId', step_row.id,
      'stepName', step_row.name,
      'stepPosition', step_row.position,
      'due', coalesce(step_row.due_date, deliverable.due_date, project.due_date),
      'note', coalesce(nullif(step_row.note, ''), deliverable.note, ''),
      'links', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', link.id,
          'href', link.url,
          'label', link.label,
          'stepId', link.deliverable_step_id
        ) order by link.position)
        from public.deliverable_links link
        where link.agency_id = deliverable.agency_id
          and link.deliverable_id = deliverable.id
      ), '[]'::jsonb),
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', file_row.id,
          'name', file_row.name,
          'type', file_row.mime_type,
          'size', file_row.size_bytes,
          'storagePath', file_row.storage_path,
          'stepPosition', file_row.step_position,
          'stepName', file_row.step_name,
          'createdAt', file_row.created_at
        ) order by file_row.position)
        from public.files file_row
        where file_row.agency_id = deliverable.agency_id
          and file_row.deliverable_id = deliverable.id
          and file_row.kind = 'deliverable_attachment'
      ), '[]'::jsonb),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', decision.id,
          'decision', decision.decision,
          'comment', decision.comment,
          'stepId', decision.deliverable_step_id,
          'fromStepPosition', decision.from_step_position,
          'toStepPosition', decision.to_step_position,
          'decidedBy', decision.decided_by_name,
          'decidedByRole', decision.decided_by_role,
          'decidedAt', decision.decided_at
        ) order by decision.decided_at desc)
        from public.client_approval_decisions decision
        where decision.agency_id = deliverable.agency_id
          and decision.deliverable_id = deliverable.id
      ), '[]'::jsonb)
    ) as item
    from public.deliverables deliverable
    join public.projects project
      on project.agency_id = deliverable.agency_id
     and project.id = deliverable.project_id
    join public.clients client
      on client.agency_id = project.agency_id
     and client.id = project.client_id
    join public.deliverable_steps step_row
      on step_row.agency_id = deliverable.agency_id
     and step_row.deliverable_id = deliverable.id
     and step_row.position = deliverable.current_step_position
    join public.agency_groups group_row
      on group_row.agency_id = step_row.agency_id
     and group_row.id = step_row.group_id
     and group_row.is_client_group
    where deliverable.agency_id = v_agency_id
      and deliverable.status = 'active'
      and (v_role <> 'client' or project.client_id = v_client_id)
  ) queue;

  return jsonb_build_object(
    'items', v_items,
    'role', v_role,
    'canDecide', v_role in ('owner', 'admin', 'client')
  );
end;
$$;

create or replace function public.load_client_approval_queue()
returns jsonb
language sql
stable
security invoker
set search_path = private, pg_catalog
as $$
  select private.load_client_approval_queue_internal()
$$;

revoke all on function private.load_client_approval_queue_internal() from public, anon, authenticated;
revoke all on function public.load_client_approval_queue() from public, anon, authenticated;
grant execute on function private.load_client_approval_queue_internal() to authenticated;
grant execute on function public.load_client_approval_queue() to authenticated;

create or replace function private.submit_client_approval_internal(
  p_deliverable_id uuid,
  p_step_id uuid,
  p_decision text,
  p_comment text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_agency_id uuid := private.current_agency_id();
  v_role text := private.current_user_role();
  v_client_id uuid := private.current_client_id();
  v_comment text := trim(coalesce(p_comment, ''));
  v_project_id uuid;
  v_project_client_id uuid;
  v_step_position integer;
  v_max_step_position integer;
  v_target_position integer;
  v_actor_name text;
  v_deliverable_name text;
  v_returned_step_id uuid;
  v_status text := 'active';
begin
  if v_user_id is null
     or v_agency_id is null
     or v_role not in ('owner', 'admin', 'client') then
    raise exception 'Você não tem permissão para decidir esta aprovação.'
      using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;

  if char_length(v_comment) > 2000 then
    raise exception 'O comentário deve ter no máximo 2000 caracteres.'
      using errcode = '22001';
  end if;

  if p_decision = 'rejected' and v_comment = '' then
    raise exception 'Explique os ajustes necessários antes de reprovar.'
      using errcode = '23514';
  end if;

  select
    project.id,
    project.client_id,
    step_row.position,
    deliverable.name
  into
    v_project_id,
    v_project_client_id,
    v_step_position,
    v_deliverable_name
  from public.deliverables deliverable
  join public.projects project
    on project.agency_id = deliverable.agency_id
   and project.id = deliverable.project_id
  join public.deliverable_steps step_row
    on step_row.agency_id = deliverable.agency_id
   and step_row.deliverable_id = deliverable.id
   and step_row.position = deliverable.current_step_position
  join public.agency_groups group_row
    on group_row.agency_id = step_row.agency_id
   and group_row.id = step_row.group_id
   and group_row.is_client_group
  where deliverable.agency_id = v_agency_id
    and deliverable.id = p_deliverable_id
    and deliverable.status = 'active'
    and step_row.id = p_step_id
  for update of deliverable;

  if v_project_id is null then
    raise exception 'Esta aprovação não está mais pendente. Atualize a página.'
      using errcode = '40001';
  end if;

  if v_role = 'client'
     and (v_client_id is null or v_project_client_id <> v_client_id) then
    raise exception 'Esta aprovação não pertence ao seu cliente.'
      using errcode = '42501';
  end if;

  select max(position)
  into v_max_step_position
  from public.deliverable_steps
  where agency_id = v_agency_id
    and deliverable_id = p_deliverable_id;

  if p_decision = 'approved' then
    if v_step_position >= v_max_step_position then
      v_target_position := null;
      v_status := 'done';
      update public.deliverables
      set status = 'done'
      where agency_id = v_agency_id and id = p_deliverable_id;
    else
      v_target_position := v_step_position + 1;
      update public.deliverables
      set current_step_position = v_target_position,
          status = 'active'
      where agency_id = v_agency_id and id = p_deliverable_id;
    end if;
  else
    if v_step_position = 0 then
      raise exception 'Não existe uma etapa anterior para receber os ajustes.'
        using errcode = '23514';
    end if;

    v_target_position := v_step_position - 1;
    update public.deliverables
    set current_step_position = v_target_position,
        status = 'active',
        note = concat_ws(
          E'\n\n',
          nullif(note, ''),
          'Ajustes solicitados em ' || to_char(current_date, 'DD/MM/YYYY') || E':\n' || v_comment
        )
    where agency_id = v_agency_id and id = p_deliverable_id;

    select id into v_returned_step_id
    from public.deliverable_steps
    where agency_id = v_agency_id
      and deliverable_id = p_deliverable_id
      and position = v_target_position;

    if v_returned_step_id is not null and not exists (
      select 1 from public.step_tasks task
      where task.agency_id = v_agency_id
        and task.deliverable_step_id = v_returned_step_id
        and task.done = false
        and task.title = 'Aplicar ajustes solicitados na aprovação'
    ) then
      insert into public.step_tasks (
        agency_id, deliverable_step_id, title, done, position,
        created_by, updated_by
      ) values (
        v_agency_id,
        v_returned_step_id,
        'Aplicar ajustes solicitados na aprovação',
        false,
        coalesce((
          select max(position) + 1
          from public.step_tasks
          where agency_id = v_agency_id
            and deliverable_step_id = v_returned_step_id
        ), 0),
        v_user_id,
        v_user_id
      );
    end if;
  end if;

  update public.projects
  set updated_at = now()
  where agency_id = v_agency_id and id = v_project_id;

  select coalesce(
    (select staff.full_name from public.platform_staff staff where staff.id = v_user_id),
    (select profile.full_name from public.profiles profile where profile.id = v_user_id),
    (select account.email from auth.users account where account.id = v_user_id),
    'Usuário'
  ) into v_actor_name;

  insert into public.client_approval_decisions (
    agency_id, client_id, project_id, deliverable_id, deliverable_step_id,
    decision, comment, from_step_position, to_step_position,
    decided_by, decided_by_name, decided_by_role
  ) values (
    v_agency_id, v_project_client_id, v_project_id, p_deliverable_id, p_step_id,
    p_decision, v_comment, v_step_position, v_target_position,
    v_user_id, v_actor_name, v_role
  );

  insert into public.activity_events (
    agency_id, actor_id, action, detail, source, occurred_at
  ) values (
    v_agency_id,
    v_user_id,
    case when p_decision = 'approved' then 'Aprovação concluída' else 'Ajustes solicitados' end,
    case
      when p_decision = 'approved' then v_deliverable_name
      else v_deliverable_name || ': ' || v_comment
    end,
    'app',
    now()
  );

  update public.agency_operation_state
  set revision = revision + 1
  where agency_id = v_agency_id;

  return jsonb_build_object(
    'success', true,
    'decision', p_decision,
    'status', v_status,
    'nextStepPosition', v_target_position
  );
end;
$$;

create or replace function public.submit_client_approval(
  p_deliverable_id uuid,
  p_step_id uuid,
  p_decision text,
  p_comment text default ''
)
returns jsonb
language sql
security invoker
set search_path = private, pg_catalog
as $$
  select private.submit_client_approval_internal(
    p_deliverable_id,
    p_step_id,
    p_decision,
    p_comment
  )
$$;

revoke all on function private.submit_client_approval_internal(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.submit_client_approval(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.submit_client_approval_internal(uuid, uuid, text, text) to authenticated;
grant execute on function public.submit_client_approval(uuid, uuid, text, text) to authenticated;

create or replace function public.load_agency_state()
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_catalog
as $$
  with context as (
    select private.current_agency_id() agency_id
  )
  select case
    when context.agency_id is null then
      jsonb_build_object('version', 4, 'initialized', false, 'revision', 0)
    else jsonb_build_object(
      'version', 4,
      'initialized', exists(select 1 from public.agency_operation_state s where s.agency_id = context.agency_id),
      'revision', coalesce((select s.revision from public.agency_operation_state s where s.agency_id = context.agency_id), 0),
      'legacyImported', exists(select 1 from public.legacy_imports i where i.agency_id = context.agency_id),
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name, 'initials', g.initials,
          'isClientGroup', g.is_client_group, 'revision', g.revision
        ) order by g.position)
        from public.agency_groups g where g.agency_id = context.agency_id
      ), '[]'::jsonb),
      'workflows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', w.id, 'name', w.name, 'category', w.category,
          'description', w.description, 'color', w.color, 'active', w.active,
          'revision', w.revision,
          'steps', coalesce((
            select jsonb_agg(jsonb_build_array(ws.name, ws.group_id, ws.id) order by ws.position)
            from public.workflow_steps ws
            where ws.agency_id = w.agency_id and ws.workflow_id = w.id
          ), '[]'::jsonb)
        ) order by w.position)
        from public.workflows w where w.agency_id = context.agency_id
      ), '[]'::jsonb),
      'clients', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'color', c.color,
          'logoId', coalesce(c.logo_file_id::text, ''),
          'createdAt', c.created_at, 'revision', c.revision,
          'workspaceInitialized', c.workspace_initialized,
          'workspace', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', b.id, 'type', b.block_type) || b.content
              order by b.position
            )
            from public.client_workspace_blocks b
            where b.agency_id = c.agency_id and b.client_id = c.id
          ), '[]'::jsonb)
        ) order by c.position)
        from public.clients c where c.agency_id = context.agency_id
      ), '[]'::jsonb),
      'projects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'clientId', p.client_id, 'client', c.name,
          'name', p.name, 'due', p.due_date, 'createdAt', p.created_at,
          'updatedAt', p.updated_at, 'revision', p.revision
        ) order by p.position)
        from public.projects p
        join public.clients c on c.agency_id = p.agency_id and c.id = p.client_id
        where p.agency_id = context.agency_id
      ), '[]'::jsonb),
      'deliverables', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'projectId', d.project_id, 'workflowId', d.workflow_id,
          'name', d.name, 'category', d.category, 'color', d.color,
          'due', coalesce(d.due_date::text, ''), 'status', d.status,
          'stepIndex', d.current_step_position, 'createdAt', d.created_at,
          'note', d.note, 'revision', d.revision,
          'steps', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', ds.id, 'sourceStepId', ds.source_workflow_step_id,
              'name', ds.name, 'groupId', ds.group_id,
              'due', coalesce(ds.due_date::text, ''), 'note', ds.note,
              'revision', ds.revision,
              'tasks', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', t.id, 'title', t.title, 'done', t.done, 'revision', t.revision
                ) order by t.position)
                from public.step_tasks t
                where t.agency_id = ds.agency_id and t.deliverable_step_id = ds.id
              ), '[]'::jsonb)
            ) order by ds.position)
            from public.deliverable_steps ds
            where ds.agency_id = d.agency_id and ds.deliverable_id = d.id
          ), '[]'::jsonb),
          'links', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', l.id, 'href', l.url, 'label', l.label,
              'stepId', l.deliverable_step_id, 'revision', l.revision
            ) order by l.position)
            from public.deliverable_links l
            where l.agency_id = d.agency_id and l.deliverable_id = d.id
          ), '[]'::jsonb),
          'attachments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', f.id, 'name', f.name, 'type', f.mime_type,
              'size', f.size_bytes, 'createdAt', f.created_at,
              'stepIndex', f.step_position, 'stepName', f.step_name,
              'storagePath', f.storage_path, 'revision', f.revision
            ) order by f.position)
            from public.files f
            where f.agency_id = d.agency_id and f.deliverable_id = d.id
              and f.kind = 'deliverable_attachment'
          ), '[]'::jsonb),
          'approvalDecisions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', decision.id,
              'stepId', decision.deliverable_step_id,
              'decision', decision.decision,
              'comment', decision.comment,
              'fromStepPosition', decision.from_step_position,
              'toStepPosition', decision.to_step_position,
              'decidedBy', decision.decided_by_name,
              'decidedByRole', decision.decided_by_role,
              'decidedAt', decision.decided_at
            ) order by decision.decided_at desc)
            from public.client_approval_decisions decision
            where decision.agency_id = d.agency_id
              and decision.deliverable_id = d.id
          ), '[]'::jsonb)
        ) order by d.position)
        from public.deliverables d where d.agency_id = context.agency_id
      ), '[]'::jsonb),
      'activity', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'action', a.action, 'detail', a.detail, 'at', a.occurred_at
        ) order by a.occurred_at desc)
        from (
          select * from public.activity_events e
          where e.agency_id = context.agency_id
          order by e.occurred_at desc limit 50
        ) a
      ), '[]'::jsonb),
      'files', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'storagePath', f.storage_path, 'kind', f.kind,
          'clientId', f.client_id, 'workspaceBlockId', f.workspace_block_id
        ))
        from public.files f where f.agency_id = context.agency_id
      ), '[]'::jsonb)
    )
  end
  from context
$$;

create or replace function private.handle_new_doti_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  new_agency_id uuid;
  new_full_name text;
  new_agency_name text;
  invitation_id_text text;
  platform_invitation_id_text text;
  matching_invitation public.team_invitations%rowtype;
  matching_platform_invitation public.platform_staff_invitations%rowtype;
begin
  new_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(new.email, '@', 1)
  );
  new_agency_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'agency_name'), ''),
    'Minha agência'
  );

  platform_invitation_id_text := nullif(
    new.raw_user_meta_data ->> 'platform_invitation_id',
    ''
  );
  if platform_invitation_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into matching_platform_invitation
    from public.platform_staff_invitations
    where id = platform_invitation_id_text::uuid
      and lower(email) = lower(new.email)
      and status = 'pending'
      and expires_at > now()
    for update;
  end if;

  if matching_platform_invitation.id is not null then
    insert into public.platform_staff (
      id, email, full_name, role, is_active, created_by
    ) values (
      new.id,
      new.email,
      matching_platform_invitation.full_name,
      matching_platform_invitation.role,
      true,
      matching_platform_invitation.invited_by
    );
    update public.platform_staff_invitations
    set status = 'accepted', accepted_at = now()
    where id = matching_platform_invitation.id;
    return new;
  end if;

  invitation_id_text := nullif(new.raw_user_meta_data ->> 'invitation_id', '');
  if invitation_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into matching_invitation
    from public.team_invitations
    where id = invitation_id_text::uuid
      and lower(email) = lower(new.email)
      and status = 'pending'
      and expires_at > now()
    for update;
  end if;

  if matching_invitation.id is not null then
    select name into new_agency_name
    from public.agencies
    where id = matching_invitation.agency_id;

    insert into public.profiles (
      id, agency_id, email, full_name, agency_name,
      role, client_id, is_active
    ) values (
      new.id,
      matching_invitation.agency_id,
      new.email,
      matching_invitation.full_name,
      new_agency_name,
      matching_invitation.role,
      matching_invitation.client_id,
      true
    );
    return new;
  end if;

  insert into public.agencies (name, owner_id)
  values (new_agency_name, new.id)
  returning id into new_agency_id;

  insert into public.profiles (
    id, agency_id, email, full_name, agency_name, role
  ) values (
    new.id, new_agency_id, new.email, new_full_name, new_agency_name, 'owner'
  );
  return new;
end;
$$;

revoke all on function private.handle_new_doti_user() from public, anon, authenticated;
