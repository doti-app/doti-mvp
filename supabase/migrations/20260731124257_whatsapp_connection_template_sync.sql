-- Doti Goal 2: validação da conexão e sincronização segura de templates aprovados.

alter table public.meta_templates
  add column parameters jsonb not null default '[]'::jsonb
  check (jsonb_typeof(parameters) = 'array');

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
    token_expires_at, status, last_verified_at, created_by, updated_by
  )
  values (
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

  select credential.* into v_secret
  from private.meta_connection_credentials credential
  join public.meta_connections connection
    on connection.id = credential.connection_id
   and connection.agency_id = credential.agency_id
  where credential.connection_id = p_connection_id
    and credential.agency_id = p_agency_id;

  if v_secret.connection_id is null then
    raise exception 'Credencial da conexão não encontrada.'
      using errcode = 'P0002';
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
    raise exception 'Lista de templates inválida.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = p_actor_id
      and agency_id = p_agency_id
      and is_active = true
      and role in ('owner', 'admin')
  ) or not exists (
    select 1 from public.meta_connections
    where id = p_connection_id and agency_id = p_agency_id
  ) then
    raise exception 'Operação administrativa não autorizada.'
      using errcode = '42501';
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
      raise exception 'Template aprovado inválido.'
        using errcode = '22023';
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

create or replace function public.store_validated_meta_connection(
  p_connection_id uuid,
  p_agency_id uuid,
  p_name text,
  p_whatsapp_business_account_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_token_ciphertext text,
  p_token_iv text,
  p_key_version smallint,
  p_actor_id uuid,
  p_templates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_connection jsonb;
  v_sync jsonb;
begin
  v_connection := public.store_meta_connection_secret(
    p_connection_id, p_agency_id, p_name, '',
    p_whatsapp_business_account_id, p_phone_number_id,
    p_display_phone_number, null, p_token_ciphertext,
    p_token_iv, p_key_version, p_actor_id
  );
  v_sync := public.sync_approved_meta_templates(
    p_connection_id, p_agency_id, p_actor_id, p_templates
  );
  return jsonb_build_object('connection', v_connection, 'sync', v_sync);
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
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and agency_id = p_agency_id
      and is_active = true and role in ('owner', 'admin')
  ) then
    raise exception 'Operação administrativa não autorizada.'
      using errcode = '42501';
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

revoke all on function public.get_meta_connection_secret(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sync_approved_meta_templates(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.store_validated_meta_connection(
  uuid, uuid, text, text, text, text, text, text, smallint, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.mark_meta_connection_check(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;

grant execute on function public.get_meta_connection_secret(uuid, uuid, uuid)
  to service_role;
grant execute on function public.sync_approved_meta_templates(uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.store_validated_meta_connection(
  uuid, uuid, text, text, text, text, text, text, smallint, uuid, jsonb
) to service_role;
grant execute on function public.mark_meta_connection_check(uuid, uuid, uuid, boolean)
  to service_role;
