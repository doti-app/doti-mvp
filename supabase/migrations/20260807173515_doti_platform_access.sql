-- Doti: acesso interno da plataforma, contexto de suporte e ciclo de vida de agencias.

create table public.platform_staff (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  role text not null check (role in ('admin', 'member', 'viewer')),
  is_active boolean not null default true,
  avatar_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    avatar_url is null
    or avatar_url ~ '^/assets/avatars-users/avatar-(0[1-9]|[12][0-9]|30)\.png$'
  )
);

create unique index platform_staff_email_unique_idx
  on public.platform_staff(lower(email));
create index platform_staff_active_role_idx
  on public.platform_staff(is_active, role);

create table public.platform_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  role text not null check (role in ('admin', 'member', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index platform_staff_invitations_pending_email_idx
  on public.platform_staff_invitations(lower(email))
  where status = 'pending';

create table public.platform_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  action text not null check (char_length(action) between 2 and 120),
  resource_type text check (resource_type is null or char_length(resource_type) <= 120),
  resource_id text check (resource_id is null or char_length(resource_id) <= 200),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now()
);

create index platform_audit_events_agency_time_idx
  on public.platform_audit_events(agency_id, occurred_at desc);
create index platform_audit_events_actor_time_idx
  on public.platform_audit_events(actor_id, occurred_at desc);

alter table public.agencies
  add column status text not null default 'active'
    check (status in ('active', 'archived')),
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null;

alter table public.platform_staff enable row level security;
alter table public.platform_staff_invitations enable row level security;
alter table public.platform_audit_events enable row level security;

create policy "Staff can read their own platform access"
on public.platform_staff for select to authenticated
using (id = (select auth.uid()));

create policy "Browser users cannot read platform invitations"
on public.platform_staff_invitations as restrictive for all to authenticated
using (false) with check (false);

create policy "Browser users cannot read platform audit directly"
on public.platform_audit_events as restrictive for all to authenticated
using (false) with check (false);

create or replace function private.requested_platform_agency_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  headers jsonb;
  requested text;
begin
  headers := coalesce(
    nullif(current_setting('request.headers', true), ''),
    '{}'
  )::jsonb;
  requested := nullif(headers ->> 'x-doti-agency-id', '');
  if requested is null then return null; end if;
  if requested !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return requested::uuid;
end;
$$;

create or replace function private.current_platform_role()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select role
  from public.platform_staff
  where id = (select auth.uid())
    and is_active = true
$$;

create or replace function private.current_agency_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, private, pg_catalog
as $$
declare
  requested uuid := private.requested_platform_agency_id();
  staff_role text;
  profile_agency uuid;
begin
  if requested is not null then
    select role into staff_role
    from public.platform_staff
    where id = (select auth.uid()) and is_active = true;

    if staff_role is not null and exists (
      select 1 from public.agencies
      where id = requested and status = 'active'
    ) then
      return requested;
    end if;
    if staff_role is not null then return null; end if;
  end if;

  select p.agency_id into profile_agency
  from public.profiles p
  join public.agencies a on a.id = p.agency_id and a.status = 'active'
  where p.id = (select auth.uid())
    and p.is_active = true;
  return profile_agency;
end;
$$;

create or replace function private.current_user_role()
returns text
language plpgsql
stable
security definer
set search_path = public, private, pg_catalog
as $$
declare
  requested uuid := private.requested_platform_agency_id();
  staff_role text;
begin
  if requested is not null then
    select role into staff_role
    from public.platform_staff
    where id = (select auth.uid()) and is_active = true;
    if staff_role is not null then
      if private.current_agency_id() is null then return null; end if;
      return staff_role;
    end if;
  end if;

  return (
    select p.role
    from public.profiles p
    join public.agencies a on a.id = p.agency_id and a.status = 'active'
    where p.id = (select auth.uid()) and p.is_active = true
  );
end;
$$;

create or replace function private.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $$
  select (select auth.uid()) is not null
    and private.current_agency_id() is not null
    and private.current_user_role() is not null
$$;

create or replace function private.can_write_operation()
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $$
  select (select auth.uid()) is not null
    and private.current_agency_id() is not null
    and private.current_user_role() in ('owner', 'admin', 'member')
$$;

create or replace function private.can_manage_operation()
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $$
  select (select auth.uid()) is not null
    and private.current_agency_id() is not null
    and private.current_user_role() in ('owner', 'admin')
$$;

revoke all on function private.requested_platform_agency_id() from public, anon, authenticated;
revoke all on function private.current_platform_role() from public, anon, authenticated;
revoke all on function private.current_agency_id() from public, anon, authenticated;
revoke all on function private.current_user_role() from public, anon, authenticated;
revoke all on function private.current_user_is_active() from public, anon, authenticated;
revoke all on function private.can_write_operation() from public, anon, authenticated;
revoke all on function private.can_manage_operation() from public, anon, authenticated;
grant execute on function private.requested_platform_agency_id() to authenticated;
grant execute on function private.current_platform_role() to authenticated;
grant execute on function private.current_agency_id() to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.current_user_is_active() to authenticated;
grant execute on function private.can_write_operation() to authenticated;
grant execute on function private.can_manage_operation() to authenticated;

create or replace function public.get_account_context()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'userId', u.id,
    'email', u.email,
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
  from auth.users u
  left join public.platform_staff s on s.id = u.id and s.is_active = true
  left join public.profiles p on p.id = u.id
  left join public.agencies a on a.id = p.agency_id
  where u.id = (select auth.uid())
$$;

revoke all on function public.get_account_context() from public, anon, authenticated;
grant execute on function public.get_account_context() to authenticated;

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
      id, agency_id, email, full_name, agency_name, role, is_active
    ) values (
      new.id,
      matching_invitation.agency_id,
      new.email,
      matching_invitation.full_name,
      new_agency_name,
      matching_invitation.role,
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

create or replace function private.protect_last_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if old.role = 'admin' and old.is_active = true then
    if (
      tg_op = 'DELETE'
      or (
        tg_op = 'UPDATE'
        and (new.role <> 'admin' or new.is_active = false)
      )
    ) and not exists (
      select 1 from public.platform_staff s
      where s.id <> old.id and s.role = 'admin' and s.is_active = true
    ) then
      raise exception 'A DOT precisa manter ao menos um administrador ativo.'
        using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger platform_staff_protect_last_admin
before update or delete on public.platform_staff
for each row execute function private.protect_last_platform_admin();

revoke all on function private.protect_last_platform_admin()
  from public, anon, authenticated;

create trigger platform_staff_set_updated_at
before update on public.platform_staff
for each row execute procedure private.set_updated_at();

create or replace function private.audit_platform_data_change()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  actor uuid := (select auth.uid());
  row_data jsonb;
  target_agency uuid;
  target_id text;
begin
  if actor is null or not exists (
    select 1 from public.platform_staff
    where id = actor and is_active = true
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_agency := nullif(row_data ->> 'agency_id', '')::uuid;
  target_id := coalesce(row_data ->> 'id', row_data ->> 'agency_id');

  insert into public.platform_audit_events (
    actor_id, agency_id, action, resource_type, resource_id, details
  ) values (
    actor,
    target_agency,
    'data.' || lower(tg_op),
    tg_table_name,
    target_id,
    jsonb_build_object('operation', tg_op)
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.audit_platform_data_change()
  from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'agency_groups', 'workflows', 'workflow_steps', 'clients',
    'client_workspace_blocks', 'projects', 'deliverables',
    'deliverable_steps', 'step_tasks', 'deliverable_links', 'files',
    'chatbots', 'chatbot_integrations', 'chatbot_interactions',
    'meta_connections', 'meta_templates', 'meta_campaigns',
    'meta_campaign_recipients'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'create trigger %I_platform_audit after insert or update or delete on public.%I for each row execute function private.audit_platform_data_change()',
        table_name,
        table_name
      );
    end if;
  end loop;
end
$$;

grant usage on schema public to authenticated;
grant select on public.platform_staff to authenticated;
revoke insert, update, delete on public.platform_staff from authenticated, anon;
revoke all on public.platform_staff_invitations from public, anon, authenticated;
revoke all on public.platform_audit_events from public, anon, authenticated;

grant select, insert, update, delete on public.platform_staff,
  public.platform_staff_invitations, public.platform_audit_events
to service_role;
grant usage, select on sequence public.platform_audit_events_id_seq to service_role;

create or replace function public.platform_transfer_agency_owner(
  p_agency_id uuid,
  p_new_owner_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_owner_id uuid;
  new_owner public.profiles;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Transferência não autorizada.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.platform_staff
    where id = p_actor_id and role = 'admin' and is_active = true
  ) then
    raise exception 'Somente um administrador DOT pode transferir a propriedade.'
      using errcode = '42501';
  end if;

  select owner_id into current_owner_id
  from public.agencies
  where id = p_agency_id
  for update;
  if current_owner_id is null then
    raise exception 'Agência não encontrada.' using errcode = 'P0002';
  end if;

  select * into new_owner
  from public.profiles
  where id = p_new_owner_id
    and agency_id = p_agency_id
    and is_active = true
  for update;
  if new_owner.id is null then
    raise exception 'O novo proprietário precisa ser um membro ativo da agência.'
      using errcode = '22023';
  end if;

  if current_owner_id <> p_new_owner_id then
    update public.profiles set role = 'admin'
    where id = current_owner_id and agency_id = p_agency_id;
    update public.profiles set role = 'owner'
    where id = p_new_owner_id and agency_id = p_agency_id;
    update public.agencies set owner_id = p_new_owner_id
    where id = p_agency_id;
  end if;

  insert into public.platform_audit_events (
    actor_id, agency_id, action, resource_type, resource_id, details
  ) values (
    p_actor_id,
    p_agency_id,
    'agency.owner_transferred',
    'profiles',
    p_new_owner_id::text,
    jsonb_build_object('previousOwnerId', current_owner_id)
  );

  return jsonb_build_object(
    'agencyId', p_agency_id,
    'ownerId', p_new_owner_id,
    'previousOwnerId', current_owner_id
  );
end;
$$;

revoke all on function public.platform_transfer_agency_owner(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.platform_transfer_agency_owner(uuid, uuid, uuid)
  to service_role;

-- Edge Functions that handle encrypted Meta credentials use the service role, so
-- they validate the human actor explicitly instead of relying on browser RLS.
create or replace function private.platform_actor_can_manage_agency(
  p_actor_id uuid,
  p_agency_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles
    where id = p_actor_id
      and agency_id = p_agency_id
      and is_active = true
      and role in ('owner', 'admin')
  ) or (
    exists (
      select 1 from public.platform_staff
      where id = p_actor_id and role = 'admin' and is_active = true
    )
    and exists (
      select 1 from public.agencies
      where id = p_agency_id and status = 'active'
    )
  )
$$;

revoke all on function private.platform_actor_can_manage_agency(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.platform_actor_can_manage_agency(uuid, uuid)
  to service_role;

create or replace function public.store_meta_connection_secret(
  p_connection_id uuid,
  p_agency_id uuid,
  p_name text,
  p_business_account_id text,
  p_whatsapp_business_account_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_token_expires_at timestamptz,
  p_token_ciphertext text,
  p_token_iv text,
  p_key_version smallint,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_connection public.meta_connections;
begin
  if not private.platform_actor_can_manage_agency(p_actor_id, p_agency_id) then
    raise exception 'Operação administrativa não autorizada.' using errcode = '42501';
  end if;
  if p_token_ciphertext is null or char_length(p_token_ciphertext) < 24
     or p_token_iv is null or char_length(p_token_iv) < 16 then
    raise exception 'Credencial cifrada inválida.' using errcode = '22023';
  end if;

  insert into public.meta_connections (
    id, agency_id, name, business_account_id,
    whatsapp_business_account_id, phone_number_id, display_phone_number,
    token_expires_at, status, last_verified_at, created_by, updated_by
  ) values (
    p_connection_id, p_agency_id, p_name, nullif(p_business_account_id, ''),
    p_whatsapp_business_account_id, p_phone_number_id,
    nullif(p_display_phone_number, ''), p_token_expires_at,
    'active', now(), p_actor_id, p_actor_id
  )
  on conflict (id) do update set
    name = excluded.name,
    business_account_id = excluded.business_account_id,
    whatsapp_business_account_id = excluded.whatsapp_business_account_id,
    phone_number_id = excluded.phone_number_id,
    display_phone_number = excluded.display_phone_number,
    token_expires_at = excluded.token_expires_at,
    status = 'active',
    last_verified_at = now(),
    updated_by = p_actor_id
  where meta_connections.agency_id = p_agency_id
  returning * into v_connection;

  if v_connection.id is null then
    raise exception 'Conexão não encontrada nesta agência.' using errcode = '42501';
  end if;

  insert into private.meta_connection_credentials (
    connection_id, agency_id, token_ciphertext, token_iv,
    key_version, rotated_by
  ) values (
    v_connection.id, p_agency_id, p_token_ciphertext, p_token_iv,
    coalesce(p_key_version, 1), p_actor_id
  )
  on conflict (connection_id) do update set
    token_ciphertext = excluded.token_ciphertext,
    token_iv = excluded.token_iv,
    key_version = excluded.key_version,
    rotated_by = excluded.rotated_by,
    rotated_at = now()
  where meta_connection_credentials.agency_id = p_agency_id;

  return jsonb_build_object(
    'id', v_connection.id,
    'agency_id', v_connection.agency_id,
    'name', v_connection.name,
    'business_account_id', v_connection.business_account_id,
    'whatsapp_business_account_id', v_connection.whatsapp_business_account_id,
    'phone_number_id', v_connection.phone_number_id,
    'display_phone_number', v_connection.display_phone_number,
    'status', v_connection.status,
    'token_expires_at', v_connection.token_expires_at,
    'last_verified_at', v_connection.last_verified_at,
    'updated_at', v_connection.updated_at
  );
end;
$$;

create or replace function public.get_meta_connection_secret(
  p_connection_id uuid,
  p_agency_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_secret private.meta_connection_credentials;
begin
  if not private.platform_actor_can_manage_agency(p_actor_id, p_agency_id) then
    raise exception 'Operação administrativa não autorizada.' using errcode = '42501';
  end if;

  select credential.* into v_secret
  from private.meta_connection_credentials credential
  join public.meta_connections connection
    on connection.id = credential.connection_id
   and connection.agency_id = credential.agency_id
  where credential.connection_id = p_connection_id
    and credential.agency_id = p_agency_id;

  if v_secret.connection_id is null then
    raise exception 'Credencial da conexão não encontrada.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'ciphertext', v_secret.token_ciphertext,
    'iv', v_secret.token_iv,
    'keyVersion', v_secret.key_version
  );
end;
$$;

create or replace function public.sync_approved_meta_templates(
  p_connection_id uuid,
  p_agency_id uuid,
  p_actor_id uuid,
  p_templates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_template jsonb;
  v_seen_ids text[] := array[]::text[];
  v_disabled integer := 0;
begin
  if jsonb_typeof(p_templates) <> 'array' or jsonb_array_length(p_templates) > 10000 then
    raise exception 'Lista de templates inválida.' using errcode = '22023';
  end if;
  if not private.platform_actor_can_manage_agency(p_actor_id, p_agency_id)
     or not exists (
       select 1 from public.meta_connections
       where id = p_connection_id and agency_id = p_agency_id
     ) then
    raise exception 'Operação administrativa não autorizada.' using errcode = '42501';
  end if;

  for v_template in select value from jsonb_array_elements(p_templates)
  loop
    if nullif(v_template ->> 'id', '') is null
       or nullif(v_template ->> 'name', '') is null
       or nullif(v_template ->> 'language', '') is null
       or lower(v_template ->> 'status') <> 'approved'
       or lower(v_template ->> 'category') not in ('authentication', 'marketing', 'utility')
       or jsonb_typeof(coalesce(v_template -> 'components', 'null'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(v_template -> 'parameters', 'null'::jsonb)) <> 'array' then
      raise exception 'Template aprovado inválido.' using errcode = '22023';
    end if;

    v_seen_ids := array_append(v_seen_ids, v_template ->> 'id');
    insert into public.meta_templates (
      agency_id, connection_id, meta_template_id, name, language,
      category, status, components, parameters, quality_score,
      synced_at, created_by, updated_by
    ) values (
      p_agency_id, p_connection_id, v_template ->> 'id',
      v_template ->> 'name', v_template ->> 'language',
      lower(v_template ->> 'category'), 'approved',
      v_template -> 'components', v_template -> 'parameters',
      nullif(v_template ->> 'qualityScore', ''), now(), p_actor_id, p_actor_id
    )
    on conflict (agency_id, connection_id, meta_template_id) do update set
      name = excluded.name,
      language = excluded.language,
      category = excluded.category,
      status = 'approved',
      components = excluded.components,
      parameters = excluded.parameters,
      quality_score = excluded.quality_score,
      synced_at = now(),
      updated_by = p_actor_id;
  end loop;

  update public.meta_templates
  set status = 'disabled', synced_at = now(), updated_by = p_actor_id
  where agency_id = p_agency_id
    and connection_id = p_connection_id
    and status = 'approved'
    and not (meta_template_id = any(v_seen_ids));
  get diagnostics v_disabled = row_count;

  update public.meta_connections
  set status = 'active', last_verified_at = now(), last_synced_at = now(), updated_by = p_actor_id
  where id = p_connection_id and agency_id = p_agency_id;

  return jsonb_build_object(
    'approvedCount', jsonb_array_length(p_templates),
    'disabledCount', v_disabled,
    'syncedAt', now()
  );
end;
$$;

create or replace function public.mark_meta_connection_check(
  p_connection_id uuid,
  p_agency_id uuid,
  p_actor_id uuid,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if not private.platform_actor_can_manage_agency(p_actor_id, p_agency_id) then
    raise exception 'Operação administrativa não autorizada.' using errcode = '42501';
  end if;
  update public.meta_connections
  set status = case when p_success then 'active' else 'attention' end,
      last_verified_at = case when p_success then now() else last_verified_at end,
      updated_by = p_actor_id
  where id = p_connection_id and agency_id = p_agency_id;
  if not found then
    raise exception 'Conexão não encontrada nesta agência.' using errcode = 'P0002';
  end if;
end;
$$;
