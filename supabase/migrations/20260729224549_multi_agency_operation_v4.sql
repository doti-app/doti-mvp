-- Doti: operação multiagência, armazenamento de arquivos e colaboração.
-- Requer a migration multi_agency_auth_baseline.

create extension if not exists pgcrypto;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active = true
$$;

create or replace function private.current_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (private.current_profile()).agency_id
$$;

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (private.current_profile()).role
$$;

create or replace function private.can_write_operation()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (select auth.uid()) is not null
    and private.current_user_role() in ('owner', 'admin', 'member')
$$;

create or replace function private.can_manage_operation()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (select auth.uid()) is not null
    and private.current_user_role() in ('owner', 'admin')
$$;

revoke all on function private.current_profile() from public, anon;
revoke all on function private.current_agency_id() from public, anon;
revoke all on function private.current_user_role() from public, anon;
revoke all on function private.can_write_operation() from public, anon;
revoke all on function private.can_manage_operation() from public, anon;
grant execute on function private.current_profile() to authenticated;
grant execute on function private.current_agency_id() to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.can_write_operation() to authenticated;
grant execute on function private.can_manage_operation() to authenticated;

create table if not exists public.agency_operation_state (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  initialized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agency_groups (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  initials text not null check (char_length(initials) between 1 and 3),
  position integer not null default 0 check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  unique (agency_id, name)
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  category text not null check (char_length(category) between 1 and 80),
  description text not null default '',
  color text not null default 'site',
  active boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  unique (agency_id, name)
);

create table if not exists public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  workflow_id uuid not null,
  group_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  position integer not null check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  unique (agency_id, workflow_id, position),
  foreign key (agency_id, workflow_id) references public.workflows(agency_id, id) on delete cascade,
  foreign key (agency_id, group_id) references public.agency_groups(agency_id, id) on delete restrict
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color text not null,
  logo_file_id uuid,
  workspace_initialized boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  unique (agency_id, name)
);

create table if not exists public.client_workspace_blocks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null,
  block_type text not null check (block_type in ('heading', 'text', 'callout', 'colors', 'typography', 'divider', 'image', 'pdf')),
  content jsonb not null default '{}'::jsonb,
  position integer not null check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  unique (agency_id, client_id, position),
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete cascade
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  due_date date not null,
  position integer not null default 0 check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete restrict
);

create table if not exists public.deliverables (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  project_id uuid not null,
  workflow_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (char_length(category) between 1 and 80),
  color text not null default 'site',
  due_date date,
  status text not null default 'active' check (status in ('active', 'done')),
  current_step_position integer not null default 0 check (current_step_position >= 0),
  position integer not null default 0 check (position >= 0),
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  foreign key (agency_id, project_id) references public.projects(agency_id, id) on delete cascade,
  foreign key (agency_id, workflow_id) references public.workflows(agency_id, id) on delete set null (workflow_id)
);

create table if not exists public.deliverable_steps (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  deliverable_id uuid not null,
  source_workflow_step_id uuid,
  group_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  due_date date,
  note text not null default '',
  position integer not null check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  unique (agency_id, deliverable_id, position),
  foreign key (agency_id, deliverable_id) references public.deliverables(agency_id, id) on delete cascade,
  foreign key (agency_id, source_workflow_step_id) references public.workflow_steps(agency_id, id) on delete set null (source_workflow_step_id),
  foreign key (agency_id, group_id) references public.agency_groups(agency_id, id) on delete restrict
);

create table if not exists public.step_tasks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  deliverable_step_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  done boolean not null default false,
  position integer not null check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  unique (agency_id, deliverable_step_id, position),
  foreign key (agency_id, deliverable_step_id) references public.deliverable_steps(agency_id, id) on delete cascade
);

create table if not exists public.deliverable_links (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  deliverable_id uuid not null,
  deliverable_step_id uuid,
  url text not null check (char_length(url) between 1 and 2048),
  label text not null default '',
  position integer not null check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  foreign key (agency_id, deliverable_id) references public.deliverables(agency_id, id) on delete cascade,
  foreign key (agency_id, deliverable_step_id) references public.deliverable_steps(agency_id, id) on delete cascade
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid,
  workspace_block_id uuid,
  deliverable_id uuid,
  kind text not null check (kind in ('client_logo', 'workspace', 'deliverable_attachment')),
  storage_path text not null,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes between 0 and 104857600),
  step_position integer,
  step_name text,
  position integer not null default 0 check (position >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  unique (agency_id, id),
  unique (agency_id, storage_path),
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete cascade,
  foreign key (agency_id, workspace_block_id) references public.client_workspace_blocks(agency_id, id) on delete cascade,
  foreign key (agency_id, deliverable_id) references public.deliverables(agency_id, id) on delete cascade,
  check (
    (kind = 'client_logo' and client_id is not null and workspace_block_id is null and deliverable_id is null)
    or (kind = 'workspace' and client_id is not null and workspace_block_id is not null and deliverable_id is null)
    or (kind = 'deliverable_attachment' and client_id is null and workspace_block_id is null and deliverable_id is not null)
  )
);

alter table public.clients
  drop constraint if exists clients_logo_file_fk;
alter table public.clients
  add constraint clients_logo_file_fk
  foreign key (agency_id, logo_file_id)
  references public.files(agency_id, id)
  on delete set null (logo_file_id)
  deferrable initially deferred;

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  detail text not null default '',
  source text not null default 'app' check (source in ('app', 'legacy', 'system')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (agency_id, id)
);

create table if not exists public.legacy_imports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  counts jsonb not null default '{}'::jsonb,
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  unique (agency_id),
  unique (agency_id, fingerprint)
);

create index if not exists agency_groups_agency_position_idx on public.agency_groups(agency_id, position);
create index if not exists workflows_agency_position_idx on public.workflows(agency_id, position);
create index if not exists workflow_steps_workflow_position_idx on public.workflow_steps(agency_id, workflow_id, position);
create index if not exists workflow_steps_group_idx on public.workflow_steps(agency_id, group_id);
create index if not exists clients_agency_name_idx on public.clients(agency_id, name);
create index if not exists clients_logo_file_idx on public.clients(agency_id, logo_file_id);
create index if not exists client_workspace_blocks_position_idx on public.client_workspace_blocks(agency_id, client_id, position);
create index if not exists projects_agency_due_idx on public.projects(agency_id, due_date);
create index if not exists projects_client_idx on public.projects(agency_id, client_id);
create index if not exists deliverables_project_position_idx on public.deliverables(agency_id, project_id, position);
create index if not exists deliverables_workflow_idx on public.deliverables(agency_id, workflow_id);
create index if not exists deliverable_steps_position_idx on public.deliverable_steps(agency_id, deliverable_id, position);
create index if not exists deliverable_steps_source_idx on public.deliverable_steps(agency_id, source_workflow_step_id);
create index if not exists deliverable_steps_group_idx on public.deliverable_steps(agency_id, group_id);
create index if not exists step_tasks_position_idx on public.step_tasks(agency_id, deliverable_step_id, position);
create index if not exists deliverable_links_deliverable_idx on public.deliverable_links(agency_id, deliverable_id);
create index if not exists deliverable_links_step_idx on public.deliverable_links(agency_id, deliverable_step_id);
create index if not exists files_deliverable_position_idx on public.files(agency_id, deliverable_id, position);
create index if not exists files_client_idx on public.files(agency_id, client_id);
create index if not exists files_workspace_block_idx on public.files(agency_id, workspace_block_id);
create index if not exists activity_events_agency_occurred_idx on public.activity_events(agency_id, occurred_at desc);
create index if not exists activity_events_actor_idx on public.activity_events(actor_id);
create index if not exists legacy_imports_imported_by_idx on public.legacy_imports(imported_by);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'agency_groups', 'workflows', 'workflow_steps', 'clients',
    'client_workspace_blocks', 'projects', 'deliverables',
    'deliverable_steps', 'step_tasks', 'deliverable_links', 'files'
  ]
  loop
    execute format('create index if not exists %I on public.%I(created_by)', table_name || '_created_by_idx', table_name);
    execute format('create index if not exists %I on public.%I(updated_by)', table_name || '_updated_by_idx', table_name);
  end loop;
end
$$;

create or replace function private.touch_operational_row()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
  else
    new.created_by := (select auth.uid());
    new.revision := 1;
  end if;
  return new;
end;
$$;

create or replace function private.touch_operation_state()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'agency_groups', 'workflows', 'workflow_steps', 'clients',
    'client_workspace_blocks', 'projects', 'deliverables',
    'deliverable_steps', 'step_tasks', 'deliverable_links', 'files'
  ]
  loop
    execute format('drop trigger if exists %I_touch on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_touch before insert or update on public.%I for each row execute function private.touch_operational_row()',
      table_name, table_name
    );
  end loop;
end
$$;

drop trigger if exists agency_operation_state_touch on public.agency_operation_state;
create trigger agency_operation_state_touch
before update on public.agency_operation_state
for each row execute function private.touch_operation_state();

revoke all on function private.touch_operational_row() from public, anon, authenticated;
revoke all on function private.touch_operation_state() from public, anon, authenticated;

alter table public.agency_operation_state enable row level security;
alter table public.agency_groups enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.clients enable row level security;
alter table public.client_workspace_blocks enable row level security;
alter table public.projects enable row level security;
alter table public.deliverables enable row level security;
alter table public.deliverable_steps enable row level security;
alter table public.step_tasks enable row level security;
alter table public.deliverable_links enable row level security;
alter table public.files enable row level security;
alter table public.activity_events enable row level security;
alter table public.legacy_imports enable row level security;

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
      'create policy "Agency members can read" on public.%I for select to authenticated using (agency_id = private.current_agency_id())',
      table_name
    );
  end loop;
end
$$;

create policy "Writers can create operation state"
on public.agency_operation_state for insert to authenticated
with check (agency_id = private.current_agency_id() and private.can_write_operation());
create policy "Writers can update operation state"
on public.agency_operation_state for update to authenticated
using (agency_id = private.current_agency_id() and private.can_write_operation())
with check (agency_id = private.current_agency_id() and private.can_write_operation());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'client_workspace_blocks', 'projects', 'deliverables',
    'deliverable_steps', 'step_tasks', 'deliverable_links', 'files'
  ]
  loop
    execute format('create policy "Writers can insert" on public.%I for insert to authenticated with check (agency_id = private.current_agency_id() and private.can_write_operation())', table_name);
    execute format('create policy "Writers can update" on public.%I for update to authenticated using (agency_id = private.current_agency_id() and private.can_write_operation()) with check (agency_id = private.current_agency_id() and private.can_write_operation())', table_name);
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['client_workspace_blocks', 'step_tasks', 'deliverable_links', 'files']
  loop
    execute format('create policy "Writers can delete auxiliary records" on public.%I for delete to authenticated using (agency_id = private.current_agency_id() and private.can_write_operation())', table_name);
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['agency_groups', 'workflows', 'workflow_steps']
  loop
    execute format('create policy "Managers can insert configuration" on public.%I for insert to authenticated with check (agency_id = private.current_agency_id() and private.can_manage_operation())', table_name);
    execute format('create policy "Managers can update configuration" on public.%I for update to authenticated using (agency_id = private.current_agency_id() and private.can_manage_operation()) with check (agency_id = private.current_agency_id() and private.can_manage_operation())', table_name);
    execute format('create policy "Managers can delete configuration" on public.%I for delete to authenticated using (agency_id = private.current_agency_id() and private.can_manage_operation())', table_name);
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['clients', 'projects', 'deliverables', 'deliverable_steps']
  loop
    execute format('create policy "Managers can delete structural records" on public.%I for delete to authenticated using (agency_id = private.current_agency_id() and private.can_manage_operation())', table_name);
  end loop;
end
$$;

create policy "Writers can append activity"
on public.activity_events for insert to authenticated
with check (
  agency_id = private.current_agency_id()
  and private.can_write_operation()
  and actor_id = (select auth.uid())
);

create policy "Owners can record legacy import"
on public.legacy_imports for insert to authenticated
with check (
  agency_id = private.current_agency_id()
  and private.current_user_role() = 'owner'
  and imported_by = (select auth.uid())
);

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
          'id', g.id, 'name', g.name, 'initials', g.initials, 'revision', g.revision
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

create or replace function public.save_agency_state(
  p_state jsonb,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security invoker
set search_path = public, private, pg_catalog
as $$
declare
  v_agency_id uuid := private.current_agency_id();
  v_user_id uuid := (select auth.uid());
  v_role text := private.current_user_role();
  v_current_revision bigint;
  v_item jsonb;
  v_child jsonb;
  v_grandchild jsonb;
  v_id uuid;
  v_parent_id uuid;
  v_seen uuid[] := '{}'::uuid[];
  v_seen_groups uuid[] := '{}'::uuid[];
  v_seen_children uuid[];
begin
  if v_agency_id is null or v_user_id is null or v_role not in ('owner', 'admin', 'member') then
    raise exception 'Você não tem permissão para alterar a operação.' using errcode = '42501';
  end if;

  insert into public.agency_operation_state (agency_id, revision)
  values (v_agency_id, 0)
  on conflict (agency_id) do nothing;

  select revision into v_current_revision
  from public.agency_operation_state
  where agency_id = v_agency_id
  for update;

  if v_current_revision <> coalesce(p_expected_revision, -1) then
    raise exception 'A operação foi atualizada por outra pessoa. Recarregue e tente novamente.'
      using errcode = '40001',
      detail = jsonb_build_object('expected', p_expected_revision, 'actual', v_current_revision)::text;
  end if;

  if v_role in ('owner', 'admin') then
    v_seen := '{}'::uuid[];
    for v_item in select value from jsonb_array_elements(coalesce(p_state->'groups', '[]'::jsonb))
    loop
      v_id := (v_item->>'id')::uuid;
      v_seen := array_append(v_seen, v_id);
      insert into public.agency_groups (id, agency_id, name, initials, position, created_by, updated_by)
      values (v_id, v_agency_id, v_item->>'name', v_item->>'initials', array_length(v_seen, 1) - 1, v_user_id, v_user_id)
      on conflict (id) do update set
        name = excluded.name, initials = excluded.initials, position = excluded.position;
    end loop;
    v_seen_groups := v_seen;

    v_seen := '{}'::uuid[];
    for v_item in select value from jsonb_array_elements(coalesce(p_state->'workflows', '[]'::jsonb))
    loop
      v_id := (v_item->>'id')::uuid;
      v_seen := array_append(v_seen, v_id);
      insert into public.workflows (id, agency_id, name, category, description, color, active, position, created_by, updated_by)
      values (
        v_id, v_agency_id, v_item->>'name', v_item->>'category',
        coalesce(v_item->>'description', ''), coalesce(v_item->>'color', 'site'),
        coalesce((v_item->>'active')::boolean, true), array_length(v_seen, 1) - 1, v_user_id, v_user_id
      )
      on conflict (id) do update set
        name = excluded.name, category = excluded.category,
        description = excluded.description, color = excluded.color,
        active = excluded.active, position = excluded.position;

      v_seen_children := '{}'::uuid[];
      for v_child in select value from jsonb_array_elements(coalesce(v_item->'steps', '[]'::jsonb))
      loop
        v_parent_id := (v_child->>2)::uuid;
        v_seen_children := array_append(v_seen_children, v_parent_id);
        insert into public.workflow_steps (id, agency_id, workflow_id, group_id, name, position, created_by, updated_by)
        values (
          v_parent_id, v_agency_id, v_id, (v_child->>1)::uuid,
          v_child->>0, array_length(v_seen_children, 1) - 1, v_user_id, v_user_id
        )
        on conflict (id) do update set
          group_id = excluded.group_id, name = excluded.name, position = excluded.position;
      end loop;
      delete from public.workflow_steps
      where agency_id = v_agency_id and workflow_id = v_id
        and not (id = any(v_seen_children));
    end loop;
    delete from public.workflows
    where agency_id = v_agency_id and not (id = any(v_seen));
  end if;

  v_seen := '{}'::uuid[];
  for v_item in select value from jsonb_array_elements(coalesce(p_state->'clients', '[]'::jsonb))
  loop
    v_id := (v_item->>'id')::uuid;
    v_seen := array_append(v_seen, v_id);
    insert into public.clients (
      id, agency_id, name, color, workspace_initialized, position,
      created_by, updated_by, created_at
    )
    values (
      v_id, v_agency_id, v_item->>'name', coalesce(v_item->>'color', '#ffd400'),
      coalesce((v_item->>'workspaceInitialized')::boolean, true),
      array_length(v_seen, 1) - 1, v_user_id, v_user_id,
      coalesce((v_item->>'createdAt')::timestamptz, now())
    )
    on conflict (id) do update set
      name = excluded.name, color = excluded.color,
      workspace_initialized = excluded.workspace_initialized, position = excluded.position;

    v_seen_children := '{}'::uuid[];
    for v_child in select value from jsonb_array_elements(coalesce(v_item->'workspace', '[]'::jsonb))
    loop
      v_parent_id := (v_child->>'id')::uuid;
      v_seen_children := array_append(v_seen_children, v_parent_id);
      insert into public.client_workspace_blocks (
        id, agency_id, client_id, block_type, content, position, created_by, updated_by
      )
      values (
        v_parent_id, v_agency_id, v_id, v_child->>'type',
        v_child - 'id' - 'type', array_length(v_seen_children, 1) - 1, v_user_id, v_user_id
      )
      on conflict (id) do update set
        block_type = excluded.block_type, content = excluded.content, position = excluded.position;
    end loop;
    delete from public.client_workspace_blocks
    where agency_id = v_agency_id and client_id = v_id
      and not (id = any(v_seen_children));
  end loop;
  v_seen := '{}'::uuid[];
  for v_item in select value from jsonb_array_elements(coalesce(p_state->'projects', '[]'::jsonb))
  loop
    v_id := (v_item->>'id')::uuid;
    v_seen := array_append(v_seen, v_id);
    insert into public.projects (
      id, agency_id, client_id, name, due_date, position,
      created_by, updated_by, created_at, updated_at
    )
    values (
      v_id, v_agency_id, (v_item->>'clientId')::uuid, v_item->>'name',
      (v_item->>'due')::date, array_length(v_seen, 1) - 1,
      v_user_id, v_user_id,
      coalesce((v_item->>'createdAt')::timestamptz, now()),
      coalesce((v_item->>'updatedAt')::timestamptz, now())
    )
    on conflict (id) do update set
      client_id = excluded.client_id, name = excluded.name,
      due_date = excluded.due_date, position = excluded.position;
  end loop;
  v_seen := '{}'::uuid[];
  for v_item in select value from jsonb_array_elements(coalesce(p_state->'deliverables', '[]'::jsonb))
  loop
    v_id := (v_item->>'id')::uuid;
    v_seen := array_append(v_seen, v_id);
    insert into public.deliverables (
      id, agency_id, project_id, workflow_id, name, category, color,
      due_date, status, current_step_position, position, note,
      created_by, updated_by, created_at
    )
    values (
      v_id, v_agency_id, (v_item->>'projectId')::uuid,
      nullif(v_item->>'workflowId', '')::uuid, v_item->>'name',
      v_item->>'category', coalesce(v_item->>'color', 'site'),
      nullif(v_item->>'due', '')::date, coalesce(v_item->>'status', 'active'),
      coalesce((v_item->>'stepIndex')::integer, 0), array_length(v_seen, 1) - 1,
      coalesce(v_item->>'note', ''), v_user_id, v_user_id,
      coalesce((v_item->>'createdAt')::timestamptz, now())
    )
    on conflict (id) do update set
      project_id = excluded.project_id, workflow_id = excluded.workflow_id,
      name = excluded.name, category = excluded.category, color = excluded.color,
      due_date = excluded.due_date, status = excluded.status,
      current_step_position = excluded.current_step_position,
      position = excluded.position, note = excluded.note;

    v_seen_children := '{}'::uuid[];
    for v_child in select value from jsonb_array_elements(coalesce(v_item->'steps', '[]'::jsonb))
    loop
      v_parent_id := (v_child->>'id')::uuid;
      v_seen_children := array_append(v_seen_children, v_parent_id);
      insert into public.deliverable_steps (
        id, agency_id, deliverable_id, source_workflow_step_id, group_id,
        name, due_date, note, position, created_by, updated_by
      )
      values (
        v_parent_id, v_agency_id, v_id, nullif(v_child->>'sourceStepId', '')::uuid,
        (v_child->>'groupId')::uuid, v_child->>'name',
        nullif(v_child->>'due', '')::date, coalesce(v_child->>'note', ''),
        array_length(v_seen_children, 1) - 1, v_user_id, v_user_id
      )
      on conflict (id) do update set
        source_workflow_step_id = excluded.source_workflow_step_id,
        group_id = excluded.group_id, name = excluded.name,
        due_date = excluded.due_date, note = excluded.note, position = excluded.position;

      delete from public.step_tasks
      where agency_id = v_agency_id and deliverable_step_id = v_parent_id
        and id not in (
          select (task->>'id')::uuid
          from jsonb_array_elements(coalesce(v_child->'tasks', '[]'::jsonb)) task
        );

      for v_grandchild in select value from jsonb_array_elements(coalesce(v_child->'tasks', '[]'::jsonb))
      loop
        insert into public.step_tasks (
          id, agency_id, deliverable_step_id, title, done, position, created_by, updated_by
        )
        values (
          (v_grandchild->>'id')::uuid, v_agency_id, v_parent_id,
          v_grandchild->>'title', coalesce((v_grandchild->>'done')::boolean, false),
          (
            select ordinality - 1
            from jsonb_array_elements(coalesce(v_child->'tasks', '[]'::jsonb)) with ordinality task(value, ordinality)
            where task.value = v_grandchild limit 1
          ),
          v_user_id, v_user_id
        )
        on conflict (id) do update set
          title = excluded.title, done = excluded.done, position = excluded.position;
      end loop;
    end loop;

    if v_role in ('owner', 'admin') then
      delete from public.deliverable_steps
      where agency_id = v_agency_id and deliverable_id = v_id
        and not (id = any(v_seen_children));
    end if;

    delete from public.deliverable_links
    where agency_id = v_agency_id and deliverable_id = v_id
      and id not in (
        select (link->>'id')::uuid
        from jsonb_array_elements(coalesce(v_item->'links', '[]'::jsonb)) link
      );
    for v_child in
      select value || jsonb_build_object('_position', ordinality - 1)
      from jsonb_array_elements(coalesce(v_item->'links', '[]'::jsonb)) with ordinality
    loop
      insert into public.deliverable_links (
        id, agency_id, deliverable_id, deliverable_step_id,
        url, label, position, created_by, updated_by
      )
      values (
        (v_child->>'id')::uuid, v_agency_id, v_id,
        nullif(v_child->>'stepId', '')::uuid, coalesce(v_child->>'url', v_child->>'href'),
        coalesce(v_child->>'label', ''), (v_child->>'_position')::integer,
        v_user_id, v_user_id
      )
      on conflict (id) do update set
        deliverable_step_id = excluded.deliverable_step_id,
        url = excluded.url, label = excluded.label, position = excluded.position;
    end loop;

    delete from public.files
    where agency_id = v_agency_id and deliverable_id = v_id and kind = 'deliverable_attachment'
      and id not in (
        select (file->>'id')::uuid
        from jsonb_array_elements(coalesce(v_item->'attachments', '[]'::jsonb)) file
        where coalesce(file->>'storagePath', '') <> ''
      );
    for v_child in
      select value || jsonb_build_object('_position', ordinality - 1)
      from jsonb_array_elements(coalesce(v_item->'attachments', '[]'::jsonb)) with ordinality
      where coalesce(value->>'storagePath', '') <> ''
    loop
      insert into public.files (
        id, agency_id, deliverable_id, kind, storage_path, name, mime_type,
        size_bytes, step_position, step_name, position, created_by, updated_by, created_at
      )
      values (
        (v_child->>'id')::uuid, v_agency_id, v_id, 'deliverable_attachment',
        v_child->>'storagePath', v_child->>'name',
        coalesce(v_child->>'type', 'application/octet-stream'),
        coalesce((v_child->>'size')::bigint, 0),
        nullif(v_child->>'stepIndex', '')::integer, v_child->>'stepName',
        (v_child->>'_position')::integer, v_user_id, v_user_id,
        coalesce((v_child->>'createdAt')::timestamptz, now())
      )
      on conflict (id) do update set
        storage_path = excluded.storage_path, name = excluded.name,
        mime_type = excluded.mime_type, size_bytes = excluded.size_bytes,
        step_position = excluded.step_position, step_name = excluded.step_name,
        position = excluded.position;
    end loop;
  end loop;
  if v_role in ('owner', 'admin') then
    delete from public.deliverables
    where agency_id = v_agency_id and not (id = any(v_seen));
    delete from public.projects
    where agency_id = v_agency_id
      and id not in (
        select (project->>'id')::uuid
        from jsonb_array_elements(coalesce(p_state->'projects', '[]'::jsonb)) project
      );
    delete from public.clients
    where agency_id = v_agency_id
      and id not in (
        select (client->>'id')::uuid
        from jsonb_array_elements(coalesce(p_state->'clients', '[]'::jsonb)) client
      );
    delete from public.agency_groups
    where agency_id = v_agency_id and not (id = any(v_seen_groups));
  end if;

  -- Logos e arquivos do dossiê são reconciliados depois que seus pais existem.
  for v_item in select value from jsonb_array_elements(coalesce(p_state->'clients', '[]'::jsonb))
  loop
    v_id := (v_item->>'id')::uuid;
    if coalesce(v_item->>'logoId', '') <> '' and coalesce(v_item->>'logoStoragePath', '') <> '' then
      insert into public.files (
        id, agency_id, client_id, kind, storage_path, name, mime_type,
        size_bytes, position, created_by, updated_by
      )
      values (
        (v_item->>'logoId')::uuid, v_agency_id, v_id, 'client_logo',
        v_item->>'logoStoragePath', coalesce(v_item->>'logoName', 'logo'),
        coalesce(v_item->>'logoType', 'image/*'), coalesce((v_item->>'logoSize')::bigint, 0),
        0, v_user_id, v_user_id
      )
      on conflict (id) do update set
        storage_path = excluded.storage_path, name = excluded.name,
        mime_type = excluded.mime_type, size_bytes = excluded.size_bytes;
      update public.clients set logo_file_id = (v_item->>'logoId')::uuid
      where agency_id = v_agency_id and id = v_id;
    elsif coalesce(v_item->>'logoId', '') = '' then
      update public.clients set logo_file_id = null
      where agency_id = v_agency_id and id = v_id;
    end if;

    for v_child in select value from jsonb_array_elements(coalesce(v_item->'workspace', '[]'::jsonb))
    loop
      if coalesce(v_child->>'fileId', '') <> '' and coalesce(v_child->>'storagePath', '') <> '' then
        insert into public.files (
          id, agency_id, client_id, workspace_block_id, kind, storage_path,
          name, mime_type, size_bytes, position, created_by, updated_by
        )
        values (
          (v_child->>'fileId')::uuid, v_agency_id, v_id, (v_child->>'id')::uuid,
          'workspace', v_child->>'storagePath', coalesce(v_child->>'name', 'arquivo'),
          coalesce(v_child->>'mimeType', 'application/octet-stream'),
          coalesce((v_child->>'size')::bigint, 0), 0, v_user_id, v_user_id
        )
        on conflict (id) do update set
          storage_path = excluded.storage_path, name = excluded.name,
          mime_type = excluded.mime_type, size_bytes = excluded.size_bytes;
      end if;
    end loop;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_state->'activity', '[]'::jsonb))
  loop
    insert into public.activity_events (
      id, agency_id, actor_id, action, detail, source, occurred_at
    )
    values (
      (v_item->>'id')::uuid, v_agency_id, v_user_id,
      v_item->>'action', coalesce(v_item->>'detail', ''),
      case when coalesce((p_state->>'version')::integer, 4) < 4 then 'legacy' else 'app' end,
      coalesce((v_item->>'at')::timestamptz, now())
    )
    on conflict (id) do nothing;
  end loop;

  update public.agency_operation_state
  set revision = revision + 1
  where agency_id = v_agency_id
  returning revision into v_current_revision;

  return v_current_revision;
end;
$$;

create or replace function public.import_legacy_state(
  p_state jsonb,
  p_fingerprint text,
  p_counts jsonb,
  p_expected_revision bigint default 0
)
returns bigint
language plpgsql
security invoker
set search_path = public, private, pg_catalog
as $$
declare
  v_agency_id uuid := private.current_agency_id();
  v_revision bigint;
begin
  if private.current_user_role() <> 'owner' then
    raise exception 'Somente o proprietário pode importar a operação local.' using errcode = '42501';
  end if;
  if p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Impressão digital inválida.' using errcode = '22023';
  end if;
  if exists(select 1 from public.legacy_imports where agency_id = v_agency_id) then
    raise exception 'Esta agência já possui uma importação oficial.' using errcode = '23505';
  end if;

  v_revision := public.save_agency_state(p_state, p_expected_revision);
  insert into public.legacy_imports (agency_id, fingerprint, counts, imported_by)
  values (v_agency_id, p_fingerprint, coalesce(p_counts, '{}'::jsonb), (select auth.uid()));
  return v_revision;
end;
$$;

revoke all on function public.load_agency_state() from public, anon;
revoke all on function public.save_agency_state(jsonb, bigint) from public, anon;
revoke all on function public.import_legacy_state(jsonb, text, jsonb, bigint) from public, anon;
grant execute on function public.load_agency_state() to authenticated;
grant execute on function public.save_agency_state(jsonb, bigint) to authenticated;
grant execute on function public.import_legacy_state(jsonb, text, jsonb, bigint) to authenticated;

grant usage on schema public to authenticated;
grant select on public.agency_operation_state, public.agency_groups, public.workflows,
  public.workflow_steps, public.clients, public.client_workspace_blocks,
  public.projects, public.deliverables, public.deliverable_steps, public.step_tasks,
  public.deliverable_links, public.files, public.activity_events, public.legacy_imports
to authenticated;
grant insert, update on public.agency_operation_state to authenticated;
grant insert, update, delete on public.agency_groups, public.workflows, public.workflow_steps,
  public.clients, public.client_workspace_blocks, public.projects, public.deliverables,
  public.deliverable_steps, public.step_tasks, public.deliverable_links, public.files
to authenticated;
grant insert on public.activity_events, public.legacy_imports to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'doti-files',
  'doti-files',
  false,
  104857600,
  array['image/*', 'application/pdf', 'video/*']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Agency members can download Doti files" on storage.objects;
create policy "Agency members can download Doti files"
on storage.objects for select to authenticated
using (
  bucket_id = 'doti-files'
  and (storage.foldername(name))[1] = private.current_agency_id()::text
);

drop policy if exists "Agency writers can upload Doti files" on storage.objects;
create policy "Agency writers can upload Doti files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'doti-files'
  and private.can_write_operation()
  and (storage.foldername(name))[1] = private.current_agency_id()::text
);

drop policy if exists "Agency writers can replace Doti files" on storage.objects;
create policy "Agency writers can replace Doti files"
on storage.objects for update to authenticated
using (
  bucket_id = 'doti-files'
  and private.can_write_operation()
  and (storage.foldername(name))[1] = private.current_agency_id()::text
)
with check (
  bucket_id = 'doti-files'
  and private.can_write_operation()
  and (storage.foldername(name))[1] = private.current_agency_id()::text
);

drop policy if exists "Agency writers can remove Doti files" on storage.objects;
create policy "Agency writers can remove Doti files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'doti-files'
  and private.can_write_operation()
  and (storage.foldername(name))[1] = private.current_agency_id()::text
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'agency_groups', 'workflows', 'workflow_steps', 'clients',
    'client_workspace_blocks', 'projects', 'deliverables',
    'deliverable_steps', 'step_tasks', 'deliverable_links', 'files',
    'activity_events'
  ]
  loop
    execute format('alter table public.%I replica identity full', table_name);
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;
