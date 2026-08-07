-- Doti: fundação segura e multiagência para integração com a Meta.
-- O token nunca é armazenado no schema público. A Edge Function cifra o
-- segredo antes de chamar a função service-role-only definida ao final.

create extension if not exists pgcrypto;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  business_account_id text,
  whatsapp_business_account_id text not null,
  phone_number_id text not null,
  display_phone_number text,
  status text not null default 'active'
    check (status in ('active', 'attention', 'disconnected')),
  token_expires_at timestamptz,
  last_verified_at timestamptz,
  last_synced_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  unique (agency_id, phone_number_id)
);

comment on table public.meta_connections is
  'Metadados não sensíveis das conexões Meta. Credenciais ficam em private.meta_connection_credentials.';

create table private.meta_connection_credentials (
  connection_id uuid primary key,
  agency_id uuid not null,
  token_ciphertext text not null check (char_length(token_ciphertext) >= 24),
  token_iv text not null check (char_length(token_iv) >= 16),
  encryption_algorithm text not null default 'AES-GCM-256'
    check (encryption_algorithm = 'AES-GCM-256'),
  key_version smallint not null default 1 check (key_version > 0),
  rotated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  unique (agency_id, connection_id),
  foreign key (agency_id, connection_id)
    references public.meta_connections(agency_id, id) on delete cascade
);

comment on table private.meta_connection_credentials is
  'Tokens Meta cifrados pela Edge Function com chave mantida somente nos secrets do servidor.';

create table public.meta_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  connection_id uuid not null,
  meta_template_id text not null,
  name text not null check (char_length(name) between 1 and 512),
  language text not null check (char_length(language) between 2 and 20),
  category text not null check (category in ('authentication', 'marketing', 'utility')),
  status text not null
    check (status in ('approved', 'paused', 'pending', 'rejected', 'disabled', 'unknown')),
  components jsonb not null default '[]'::jsonb
    check (jsonb_typeof(components) = 'array'),
  quality_score text,
  synced_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  unique (agency_id, connection_id, meta_template_id),
  foreign key (agency_id, connection_id)
    references public.meta_connections(agency_id, id) on delete cascade
);

create table public.meta_campaigns (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  connection_id uuid not null,
  template_id uuid not null,
  name text not null check (char_length(name) between 2 and 160),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'queued', 'running', 'completed', 'cancelled', 'failed')),
  scheduled_at timestamptz,
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  foreign key (agency_id, connection_id)
    references public.meta_connections(agency_id, id) on delete restrict,
  foreign key (agency_id, template_id)
    references public.meta_templates(agency_id, id) on delete restrict,
  check (
    status <> 'scheduled'
    or (scheduled_at is not null and scheduled_at > created_at)
  )
);

create table public.meta_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  campaign_id uuid not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  template_variables jsonb not null default '{}'::jsonb
    check (jsonb_typeof(template_variables) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  meta_message_id text,
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  unique (agency_id, campaign_id, phone_e164),
  foreign key (agency_id, campaign_id)
    references public.meta_campaigns(agency_id, id) on delete cascade
);

create table public.meta_delivery_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  connection_id uuid not null,
  campaign_id uuid,
  recipient_id uuid,
  meta_event_id text,
  meta_message_id text,
  event_type text not null
    check (event_type in ('accepted', 'sent', 'delivered', 'read', 'failed', 'deleted', 'unknown')),
  event_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(event_metadata) = 'object'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agency_id, id),
  foreign key (agency_id, connection_id)
    references public.meta_connections(agency_id, id) on delete cascade,
  foreign key (agency_id, campaign_id)
    references public.meta_campaigns(agency_id, id) on delete cascade,
  foreign key (agency_id, recipient_id)
    references public.meta_campaign_recipients(agency_id, id) on delete cascade
);

create table public.meta_admin_audit_events (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('created', 'updated', 'deleted', 'queued')),
  entity_type text not null check (entity_type in ('connection', 'template', 'campaign', 'recipient')),
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index meta_connections_agency_id_idx on public.meta_connections(agency_id);
create index meta_templates_agency_connection_idx on public.meta_templates(agency_id, connection_id);
create index meta_campaigns_agency_status_idx on public.meta_campaigns(agency_id, status);
create index meta_campaigns_scheduled_idx
  on public.meta_campaigns(scheduled_at)
  where status = 'scheduled';
create index meta_campaign_recipients_campaign_status_idx
  on public.meta_campaign_recipients(agency_id, campaign_id, status);
create index meta_campaign_recipients_message_idx
  on public.meta_campaign_recipients(agency_id, meta_message_id)
  where meta_message_id is not null;
create index meta_delivery_events_message_idx
  on public.meta_delivery_events(agency_id, meta_message_id);
create unique index meta_delivery_events_event_unique_idx
  on public.meta_delivery_events(agency_id, connection_id, meta_event_id)
  where meta_event_id is not null;
create index meta_admin_audit_events_agency_created_idx
  on public.meta_admin_audit_events(agency_id, created_at desc);
create index meta_admin_audit_events_actor_idx
  on public.meta_admin_audit_events(actor_id);

create or replace function private.touch_meta_admin_row()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is not null then
    if new.agency_id <> private.current_agency_id()
       or not private.can_manage_operation() then
      raise exception 'Operação administrativa não autorizada.'
        using errcode = '42501';
    end if;
    new.updated_by := v_actor;
    if tg_op = 'INSERT' then
      new.created_by := v_actor;
    end if;
  end if;

  if new.created_by is null or new.updated_by is null then
    raise exception 'Autor administrativo obrigatório.'
      using errcode = '23502';
  end if;

  if tg_op = 'UPDATE' then
    new.agency_id := old.agency_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.audit_meta_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_entity_type text;
  v_action text := lower(tg_op);
  v_actor uuid;
begin
  v_entity_type := case tg_table_name
    when 'meta_connections' then 'connection'
    when 'meta_templates' then 'template'
    when 'meta_campaigns' then 'campaign'
    when 'meta_campaign_recipients' then 'recipient'
  end;
  v_action := case v_action
    when 'insert' then 'created'
    when 'update' then
      case
        when tg_table_name = 'meta_campaigns'
          and v_old_row ->> 'status' is distinct from v_row ->> 'status'
          and v_row ->> 'status' = 'queued'
        then 'queued'
        else 'updated'
      end
    when 'delete' then 'deleted'
  end;
  v_actor := coalesce(
    (select auth.uid()),
    nullif(v_row ->> 'updated_by', '')::uuid,
    nullif(v_row ->> 'created_by', '')::uuid
  );

  if v_actor is null then
    raise exception 'Autor administrativo obrigatório para auditoria.'
      using errcode = '23502';
  end if;

  insert into public.meta_admin_audit_events (
    agency_id, actor_id, action, entity_type, entity_id, details
  )
  values (
    (v_row ->> 'agency_id')::uuid,
    v_actor,
    v_action,
    v_entity_type,
    (v_row ->> 'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'name', v_row ->> 'name',
      'status', v_row ->> 'status',
      'previous_status', v_old_row ->> 'status'
    ))
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meta_connections', 'meta_templates', 'meta_campaigns',
    'meta_campaign_recipients'
  ]
  loop
    execute format(
      'create trigger %I_touch before insert or update on public.%I
       for each row execute function private.touch_meta_admin_row()',
      table_name, table_name
    );
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
       for each row execute function private.audit_meta_admin_action()',
      table_name, table_name
    );
  end loop;
end
$$;

revoke all on function private.touch_meta_admin_row() from public, anon, authenticated;
revoke all on function private.audit_meta_admin_action() from public, anon, authenticated;

alter table public.meta_connections enable row level security;
alter table public.meta_templates enable row level security;
alter table public.meta_campaigns enable row level security;
alter table public.meta_campaign_recipients enable row level security;
alter table public.meta_delivery_events enable row level security;
alter table public.meta_admin_audit_events enable row level security;
alter table private.meta_connection_credentials enable row level security;

create policy "Browser roles cannot access Meta credentials"
on private.meta_connection_credentials
as restrictive
for all
to authenticated
using (false)
with check (false);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meta_connections', 'meta_templates', 'meta_campaigns',
    'meta_campaign_recipients', 'meta_delivery_events'
  ]
  loop
    execute format(
      'create policy "Agency members can read Meta data" on public.%I
       for select to authenticated
       using (agency_id = private.current_agency_id())',
      table_name
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meta_connections', 'meta_templates', 'meta_campaigns',
    'meta_campaign_recipients'
  ]
  loop
    execute format(
      'create policy "Managers can insert Meta data" on public.%I
       for insert to authenticated
       with check (
         agency_id = private.current_agency_id()
         and private.can_manage_operation()
       )',
      table_name
    );
    execute format(
      'create policy "Managers can update Meta data" on public.%I
       for update to authenticated
       using (
         agency_id = private.current_agency_id()
         and private.can_manage_operation()
       )
       with check (
         agency_id = private.current_agency_id()
         and private.can_manage_operation()
       )',
      table_name
    );
    execute format(
      'create policy "Managers can delete Meta data" on public.%I
       for delete to authenticated
       using (
         agency_id = private.current_agency_id()
         and private.can_manage_operation()
       )',
      table_name
    );
  end loop;
end
$$;

create policy "Managers can read Meta audit"
on public.meta_admin_audit_events for select to authenticated
using (
  agency_id = private.current_agency_id()
  and private.can_manage_operation()
);

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
  if not exists (
    select 1
    from public.profiles
    where id = p_actor_id
      and agency_id = p_agency_id
      and is_active = true
      and role in ('owner', 'admin')
  ) then
    raise exception 'Operação administrativa não autorizada.'
      using errcode = '42501';
  end if;
  if p_token_ciphertext is null or char_length(p_token_ciphertext) < 24
     or p_token_iv is null or char_length(p_token_iv) < 16 then
    raise exception 'Credencial cifrada inválida.'
      using errcode = '22023';
  end if;

  insert into public.meta_connections (
    id, agency_id, name, business_account_id,
    whatsapp_business_account_id, phone_number_id, display_phone_number,
    token_expires_at, status, created_by, updated_by
  )
  values (
    p_connection_id, p_agency_id, p_name, nullif(p_business_account_id, ''),
    p_whatsapp_business_account_id, p_phone_number_id,
    nullif(p_display_phone_number, ''), p_token_expires_at,
    'active', p_actor_id, p_actor_id
  )
  on conflict (id) do update set
    name = excluded.name,
    business_account_id = excluded.business_account_id,
    whatsapp_business_account_id = excluded.whatsapp_business_account_id,
    phone_number_id = excluded.phone_number_id,
    display_phone_number = excluded.display_phone_number,
    token_expires_at = excluded.token_expires_at,
    status = 'active',
    updated_by = p_actor_id
  where meta_connections.agency_id = p_agency_id
  returning * into v_connection;

  if v_connection.id is null then
    raise exception 'Conexão não encontrada nesta agência.'
      using errcode = '42501';
  end if;

  insert into private.meta_connection_credentials (
    connection_id, agency_id, token_ciphertext, token_iv,
    key_version, rotated_by
  )
  values (
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
    'updated_at', v_connection.updated_at
  );
end;
$$;

create or replace function public.queue_meta_campaign(p_campaign_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, private, pg_catalog
as $$
declare
  v_agency_id uuid := private.current_agency_id();
begin
  if not private.can_manage_operation() then
    raise exception 'Somente owner ou admin pode disparar campanhas.'
      using errcode = '42501';
  end if;

  update public.meta_campaigns
  set status = 'queued',
      queued_at = now(),
      failure_reason = null
  where id = p_campaign_id
    and agency_id = v_agency_id
    and status in ('draft', 'scheduled', 'failed');

  if not found then
    raise exception 'Campanha indisponível para disparo.'
      using errcode = 'P0002';
  end if;
  return p_campaign_id;
end;
$$;

revoke all on function public.store_meta_connection_secret(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, smallint, uuid
) from public, anon, authenticated;
grant execute on function public.store_meta_connection_secret(
  uuid, uuid, text, text, text, text, text, timestamptz, text, text, smallint, uuid
) to service_role;

revoke all on function public.queue_meta_campaign(uuid) from public, anon;
grant execute on function public.queue_meta_campaign(uuid) to authenticated;

grant usage on schema public to authenticated;
grant select on public.meta_connections, public.meta_templates,
  public.meta_campaigns, public.meta_campaign_recipients,
  public.meta_delivery_events, public.meta_admin_audit_events
to authenticated;
grant insert, update, delete on public.meta_connections, public.meta_templates,
  public.meta_campaigns, public.meta_campaign_recipients
to authenticated;

revoke all on private.meta_connection_credentials from public, anon, authenticated;
revoke all on public.meta_admin_audit_events from anon;
revoke insert, update, delete on public.meta_admin_audit_events from authenticated;
revoke insert, update, delete on public.meta_delivery_events from authenticated;

grant select, insert, update, delete on public.meta_connections,
  public.meta_templates, public.meta_campaigns,
  public.meta_campaign_recipients, public.meta_delivery_events,
  public.meta_admin_audit_events, private.meta_connection_credentials
to service_role;

grant usage, select on sequence public.meta_admin_audit_events_id_seq to service_role;

alter table public.meta_connections replica identity full;
alter table public.meta_templates replica identity full;
alter table public.meta_campaigns replica identity full;
alter table public.meta_campaign_recipients replica identity full;
alter table public.meta_delivery_events replica identity full;
