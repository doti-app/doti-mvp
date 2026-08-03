-- Doti Goal 6: rollout gradual, allowlist de piloto e observabilidade sem PII.

create table public.meta_whatsapp_rollouts (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  release_stage text not null default 'disabled'
    check (release_stage in ('disabled', 'pilot', 'general')),
  sending_enabled boolean not null default false,
  pilot_started_at timestamptz,
  general_released_at timestamptz,
  updated_at timestamptz not null default now(),
  check (release_stage <> 'disabled' or sending_enabled = false)
);

comment on table public.meta_whatsapp_rollouts is
  'Estado não sensível da liberação do WhatsApp por agência. Ausência de linha significa bloqueado.';

create table private.meta_pilot_recipient_allowlist (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  phone_sha256 text not null check (phone_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (agency_id, phone_sha256)
);

comment on table private.meta_pilot_recipient_allowlist is
  'Hashes SHA-256 de números internos autorizados no piloto; números completos nunca são armazenados aqui.';

create table private.meta_whatsapp_technical_logs (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  operation text not null check (operation in ('campaign.send', 'webhook.delivery')),
  outcome text not null check (outcome in ('success', 'retry', 'failure')),
  correlation_hash text not null check (correlation_hash ~ '^[0-9a-f]{64}$'),
  duration_ms integer check (duration_ms between 0 and 86400000),
  failure_code text check (failure_code is null or char_length(failure_code) <= 100),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now()
);

comment on table private.meta_whatsapp_technical_logs is
  'Logs operacionais sem telefone, token, wamid, variáveis ou conteúdo de mensagem.';

create index meta_whatsapp_technical_logs_monitoring_idx
  on private.meta_whatsapp_technical_logs(agency_id, created_at desc, operation, outcome);

alter table public.meta_whatsapp_rollouts enable row level security;
alter table private.meta_pilot_recipient_allowlist enable row level security;
alter table private.meta_whatsapp_technical_logs enable row level security;

create policy "Agency members can read Meta rollout state"
on public.meta_whatsapp_rollouts for select to authenticated
using (agency_id = private.current_agency_id());

create policy "Browser roles cannot access Meta pilot allowlist"
on private.meta_pilot_recipient_allowlist as restrictive for all to authenticated
using (false) with check (false);

create policy "Browser roles cannot access Meta technical logs"
on private.meta_whatsapp_technical_logs as restrictive for all to authenticated
using (false) with check (false);

grant select on public.meta_whatsapp_rollouts to authenticated;
revoke insert, update, delete on public.meta_whatsapp_rollouts from authenticated, anon;
revoke all on private.meta_pilot_recipient_allowlist from public, anon, authenticated;
revoke all on private.meta_whatsapp_technical_logs from public, anon, authenticated;
grant select, insert, update, delete on public.meta_whatsapp_rollouts,
  private.meta_pilot_recipient_allowlist to service_role;
grant select on private.meta_whatsapp_technical_logs to service_role;
grant usage, select on sequence private.meta_whatsapp_technical_logs_id_seq to service_role;
grant usage on schema private to service_role;

create or replace function public.configure_meta_whatsapp_rollout(
  p_agency_id uuid,
  p_release_stage text,
  p_sending_enabled boolean,
  p_allowed_phone_hashes text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_hash text;
  v_unique_hashes text[];
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Configuração de rollout não autorizada.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.agencies where id = p_agency_id) then
    raise exception 'Agência não encontrada.' using errcode = 'P0002';
  end if;
  if p_release_stage not in ('disabled', 'pilot', 'general')
     or (p_release_stage = 'disabled' and p_sending_enabled) then
    raise exception 'Configuração de rollout inválida.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct lower(value)), array[]::text[])
  into v_unique_hashes
  from unnest(coalesce(p_allowed_phone_hashes, array[]::text[])) value;

  if cardinality(v_unique_hashes) > 100 then
    raise exception 'A allowlist do piloto aceita no máximo 100 hashes.' using errcode = '22023';
  end if;
  foreach v_hash in array v_unique_hashes loop
    if v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'A allowlist aceita somente hashes SHA-256.' using errcode = '22023';
    end if;
  end loop;
  if p_release_stage = 'pilot' and p_sending_enabled and cardinality(v_unique_hashes) = 0 then
    raise exception 'O piloto exige ao menos um destinatário interno autorizado.' using errcode = '22023';
  end if;

  insert into public.meta_whatsapp_rollouts (
    agency_id, release_stage, sending_enabled, pilot_started_at,
    general_released_at, updated_at
  ) values (
    p_agency_id, p_release_stage, p_sending_enabled,
    case when p_release_stage = 'pilot' then now() end,
    case when p_release_stage = 'general' then now() end,
    now()
  )
  on conflict (agency_id) do update set
    release_stage = excluded.release_stage,
    sending_enabled = excluded.sending_enabled,
    pilot_started_at = case
      when excluded.release_stage = 'pilot'
      then coalesce(meta_whatsapp_rollouts.pilot_started_at, now())
      else meta_whatsapp_rollouts.pilot_started_at
    end,
    general_released_at = case
      when excluded.release_stage = 'general'
      then coalesce(meta_whatsapp_rollouts.general_released_at, now())
      else meta_whatsapp_rollouts.general_released_at
    end,
    updated_at = now();

  delete from private.meta_pilot_recipient_allowlist where agency_id = p_agency_id;
  if p_release_stage = 'pilot' then
    insert into private.meta_pilot_recipient_allowlist(agency_id, phone_sha256)
    select p_agency_id, value from unnest(v_unique_hashes) value;
  end if;

  return jsonb_build_object(
    'agencyId', p_agency_id,
    'releaseStage', p_release_stage,
    'sendingEnabled', p_sending_enabled,
    'authorizedRecipientCount', case when p_release_stage = 'pilot' then cardinality(v_unique_hashes) else 0 end
  );
end;
$$;

revoke all on function public.configure_meta_whatsapp_rollout(uuid, text, boolean, text[])
  from public, anon, authenticated;
grant execute on function public.configure_meta_whatsapp_rollout(uuid, text, boolean, text[])
  to service_role;

create or replace function private.enforce_meta_whatsapp_rollout()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  v_rollout public.meta_whatsapp_rollouts;
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if tg_op = 'UPDATE' and new.status <> 'queued' then return new; end if;

  select * into v_rollout
  from public.meta_whatsapp_rollouts
  where agency_id = new.agency_id;
  if v_rollout.agency_id is null
     or not v_rollout.sending_enabled
     or v_rollout.release_stage not in ('pilot', 'general') then
    raise exception 'O WhatsApp ainda não foi liberado para esta agência.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.status = 'queued' and v_rollout.release_stage = 'pilot'
     and exists (
       select 1
       from public.meta_campaign_recipients recipient
       where recipient.agency_id = new.agency_id
         and recipient.campaign_id = new.id
         and not exists (
           select 1
           from private.meta_pilot_recipient_allowlist allowed
           where allowed.agency_id = recipient.agency_id
             and allowed.phone_sha256 = encode(digest(recipient.phone_e164, 'sha256'), 'hex')
         )
     ) then
    raise exception 'O piloto permite somente números internos previamente autorizados.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger meta_campaigns_enforce_whatsapp_rollout
before insert or update of status on public.meta_campaigns
for each row execute function private.enforce_meta_whatsapp_rollout();

revoke all on function private.enforce_meta_whatsapp_rollout()
  from public, anon, authenticated;

create or replace function private.enforce_meta_pilot_recipient()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  v_rollout public.meta_whatsapp_rollouts;
begin
  if (select auth.uid()) is null then return new; end if;
  select * into v_rollout
  from public.meta_whatsapp_rollouts
  where agency_id = new.agency_id;
  if v_rollout.release_stage = 'pilot' and v_rollout.sending_enabled
     and not exists (
       select 1 from private.meta_pilot_recipient_allowlist allowed
       where allowed.agency_id = new.agency_id
         and allowed.phone_sha256 = encode(digest(new.phone_e164, 'sha256'), 'hex')
     ) then
    raise exception 'O piloto permite somente números internos previamente autorizados.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger meta_campaign_recipients_enforce_pilot_allowlist
before insert or update of phone_e164 on public.meta_campaign_recipients
for each row execute function private.enforce_meta_pilot_recipient();

revoke all on function private.enforce_meta_pilot_recipient()
  from public, anon, authenticated;

create or replace function private.log_meta_send_attempt()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
begin
  insert into private.meta_whatsapp_technical_logs (
    agency_id, operation, outcome, correlation_hash, duration_ms,
    failure_code, metrics
  ) values (
    new.agency_id,
    'campaign.send',
    case new.outcome when 'accepted' then 'success' when 'retry_scheduled' then 'retry' else 'failure' end,
    encode(digest(new.campaign_id::text, 'sha256'), 'hex'),
    greatest(0, least(86400000, floor(extract(epoch from (new.completed_at - new.attempted_at)) * 1000)::integer)),
    case when new.outcome = 'accepted' then null else left(coalesce(new.error_code, 'UNKNOWN'), 100) end,
    jsonb_build_object(
      'attemptNumber', new.attempt_number,
      'httpStatus', new.http_status,
      'transient', new.is_transient
    )
  );
  return new;
end;
$$;

create trigger meta_campaign_send_attempts_technical_log
after insert on public.meta_campaign_send_attempts
for each row execute function private.log_meta_send_attempt();

create or replace function private.log_meta_delivery_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
begin
  if new.event_type = 'accepted' then return new; end if;
  insert into private.meta_whatsapp_technical_logs (
    agency_id, operation, outcome, correlation_hash, duration_ms,
    failure_code, metrics
  ) values (
    new.agency_id,
    'webhook.delivery',
    case when new.event_type = 'failed' then 'failure' else 'success' end,
    encode(digest(coalesce(new.campaign_id::text, new.connection_id::text), 'sha256'), 'hex'),
    greatest(0, least(86400000, floor(extract(epoch from (new.received_at - new.occurred_at)) * 1000)::integer)),
    case when new.event_type = 'failed' then 'DELIVERY_FAILED' end,
    jsonb_build_object('eventType', new.event_type)
  );
  return new;
end;
$$;

create trigger meta_delivery_events_technical_log
after insert on public.meta_delivery_events
for each row execute function private.log_meta_delivery_webhook();

revoke all on function private.log_meta_send_attempt() from public, anon, authenticated;
revoke all on function private.log_meta_delivery_webhook() from public, anon, authenticated;

create or replace function public.get_meta_whatsapp_operational_metrics(
  p_agency_id uuid,
  p_since timestamptz default now() - interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_metrics jsonb;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Consulta operacional não autorizada.' using errcode = '42501';
  end if;
  if p_since is null or p_since < now() - interval '31 days' or p_since > now() then
    raise exception 'Janela de monitoramento inválida.' using errcode = '22023';
  end if;

  with technical as (
    select * from private.meta_whatsapp_technical_logs
    where agency_id = p_agency_id and created_at >= p_since
  ), actual_counts as (
    select campaign.id,
      count(recipient.*)::integer as total_count,
      count(*) filter (where recipient.status in ('pending', 'queued'))::integer as pending_count,
      count(*) filter (where recipient.status in ('accepted', 'sent', 'delivered', 'read'))::integer as successful_count,
      count(*) filter (where recipient.status in ('failed', 'skipped'))::integer as failed_count
    from public.meta_campaigns campaign
    left join public.meta_campaign_recipients recipient
      on recipient.campaign_id = campaign.id and recipient.agency_id = campaign.agency_id
    where campaign.agency_id = p_agency_id
    group by campaign.id
  )
  select jsonb_build_object(
    'since', p_since,
    'sendAttempts', count(*) filter (where operation = 'campaign.send'),
    'sendFailures', count(*) filter (where operation = 'campaign.send' and outcome = 'failure'),
    'sendRetries', count(*) filter (where operation = 'campaign.send' and outcome = 'retry'),
    'averageSendLatencyMs', coalesce(round(avg(duration_ms) filter (where operation = 'campaign.send')), 0),
    'p95SendLatencyMs', coalesce(round(percentile_cont(0.95) within group (order by duration_ms)
      filter (where operation = 'campaign.send')), 0),
    'webhookEvents', count(*) filter (where operation = 'webhook.delivery'),
    'counterDivergences', (
      select count(*) from actual_counts actual
      join public.meta_campaigns campaign on campaign.id = actual.id
      where campaign.total_count <> actual.total_count
         or campaign.pending_count <> actual.pending_count
         or campaign.successful_count <> actual.successful_count
         or campaign.failed_count <> actual.failed_count
    ),
    'lastTechnicalEventAt', max(created_at)
  ) into v_metrics
  from technical;
  return v_metrics;
end;
$$;

revoke all on function public.get_meta_whatsapp_operational_metrics(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_meta_whatsapp_operational_metrics(uuid, timestamptz)
  to service_role;
