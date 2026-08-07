-- Doti Goals 4 e 5: processamento idempotente, tentativas e acompanhamento de entrega.

alter table public.meta_campaign_recipients
  drop constraint meta_campaign_recipients_status_check;

alter table public.meta_campaign_recipients
  add constraint meta_campaign_recipients_status_check
    check (status in ('pending', 'queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  add column accepted_at timestamptz,
  add column attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  add column next_attempt_at timestamptz,
  add column last_attempt_at timestamptz,
  add column processing_token uuid,
  add column processing_started_at timestamptz,
  add column idempotency_key uuid not null default gen_random_uuid();

create unique index meta_campaign_recipients_idempotency_idx
  on public.meta_campaign_recipients(idempotency_key);
create index meta_campaign_recipients_dispatch_idx
  on public.meta_campaign_recipients(campaign_id, next_attempt_at, created_at)
  where status = 'pending';

alter table public.meta_campaigns
  add column total_count integer not null default 0 check (total_count >= 0),
  add column pending_count integer not null default 0 check (pending_count >= 0),
  add column successful_count integer not null default 0 check (successful_count >= 0),
  add column accepted_count integer not null default 0 check (accepted_count >= 0),
  add column sent_count integer not null default 0 check (sent_count >= 0),
  add column delivered_count integer not null default 0 check (delivered_count >= 0),
  add column read_count integer not null default 0 check (read_count >= 0),
  add column failed_count integer not null default 0 check (failed_count >= 0),
  add constraint meta_campaign_progress_balanced
    check (total_count = pending_count + successful_count + failed_count);

create table public.meta_campaign_send_attempts (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  campaign_id uuid not null,
  recipient_id uuid not null,
  attempt_number smallint not null check (attempt_number between 1 and 3),
  attempted_at timestamptz not null,
  completed_at timestamptz not null default now(),
  outcome text not null check (outcome in ('accepted', 'retry_scheduled', 'failed')),
  is_transient boolean not null,
  http_status integer,
  error_code text,
  error_message text,
  meta_message_id text,
  response_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(response_metadata) = 'object'),
  unique (agency_id, recipient_id, attempt_number),
  foreign key (agency_id, campaign_id)
    references public.meta_campaigns(agency_id, id) on delete cascade,
  foreign key (agency_id, recipient_id)
    references public.meta_campaign_recipients(agency_id, id) on delete cascade
);

create index meta_campaign_send_attempts_campaign_idx
  on public.meta_campaign_send_attempts(agency_id, campaign_id, attempted_at);

alter table public.meta_campaign_send_attempts enable row level security;
create policy "Agency members can read Meta send attempts"
on public.meta_campaign_send_attempts for select to authenticated
using (agency_id = private.current_agency_id());

grant select on public.meta_campaign_send_attempts to authenticated;
revoke insert, update, delete on public.meta_campaign_send_attempts from authenticated, anon;
grant select, insert, update, delete on public.meta_campaign_send_attempts to service_role;
grant usage, select on sequence public.meta_campaign_send_attempts_id_seq to service_role;

alter table public.meta_delivery_events
  add column event_fingerprint text;

create unique index meta_delivery_events_fingerprint_unique_idx
  on public.meta_delivery_events(event_fingerprint)
  where event_fingerprint is not null;

create or replace function private.meta_recipient_status_rank(p_status text)
returns smallint
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case p_status
    when 'pending' then 0
    when 'queued' then 0
    when 'accepted' then 10
    when 'sent' then 20
    when 'delivered' then 30
    when 'read' then 40
    when 'failed' then 50
    when 'skipped' then 50
    else -1
  end::smallint;
$$;

create or replace function private.refresh_meta_campaign_progress(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_progress record;
begin
  select
    count(*)::integer as total_count,
    count(*) filter (where status in ('pending', 'queued'))::integer as pending_count,
    count(*) filter (where status in ('accepted', 'sent', 'delivered', 'read'))::integer as successful_count,
    count(*) filter (where status = 'accepted')::integer as accepted_count,
    count(*) filter (where status = 'sent')::integer as sent_count,
    count(*) filter (where status = 'delivered')::integer as delivered_count,
    count(*) filter (where status = 'read')::integer as read_count,
    count(*) filter (where status in ('failed', 'skipped'))::integer as failed_count
  into v_progress
  from public.meta_campaign_recipients
  where campaign_id = p_campaign_id;

  update public.meta_campaigns
  set total_count = v_progress.total_count,
      pending_count = v_progress.pending_count,
      successful_count = v_progress.successful_count,
      accepted_count = v_progress.accepted_count,
      sent_count = v_progress.sent_count,
      delivered_count = v_progress.delivered_count,
      read_count = v_progress.read_count,
      failed_count = v_progress.failed_count
  where id = p_campaign_id;
end;
$$;

create or replace function private.refresh_meta_campaign_progress_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  perform private.refresh_meta_campaign_progress(coalesce(new.campaign_id, old.campaign_id));
  return coalesce(new, old);
end;
$$;

create trigger meta_campaign_recipients_refresh_progress
after insert or update of status or delete on public.meta_campaign_recipients
for each row execute function private.refresh_meta_campaign_progress_trigger();

do $$
declare
  v_campaign_id uuid;
begin
  for v_campaign_id in select id from public.meta_campaigns loop
    perform private.refresh_meta_campaign_progress(v_campaign_id);
  end loop;
end
$$;

create or replace function private.prevent_started_campaign_control()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and old.status <> 'draft' then
    raise exception 'Campanhas iniciadas não podem ser canceladas ou excluídas.'
      using errcode = '55000';
  end if;
  if tg_op = 'UPDATE'
     and old.status in ('queued', 'running', 'completed')
     and new.status in ('draft', 'scheduled', 'cancelled') then
    raise exception 'Campanhas iniciadas não podem ser pausadas ou canceladas.'
      using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger meta_campaigns_prevent_started_control
before update or delete on public.meta_campaigns
for each row execute function private.prevent_started_campaign_control();

create or replace function private.prevent_started_recipient_changes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_campaign_status text;
begin
  if (select auth.uid()) is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_campaign_status
  from public.meta_campaigns
  where id = coalesce(new.campaign_id, old.campaign_id);
  if v_campaign_status <> 'draft' then
    raise exception 'Destinatários não podem ser alterados depois do início do disparo.'
      using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger meta_campaign_recipients_prevent_started_changes
before insert or update or delete on public.meta_campaign_recipients
for each row execute function private.prevent_started_recipient_changes();

create or replace function public.claim_meta_campaign_batch(
  p_campaign_id uuid,
  p_batch_size integer default 10
)
returns table (
  agency_id uuid,
  campaign_id uuid,
  connection_id uuid,
  recipient_id uuid,
  phone_e164 text,
  template_variables jsonb,
  attempt_number smallint,
  processing_token uuid,
  idempotency_key uuid,
  phone_number_id text,
  template_name text,
  template_language text,
  template_parameters jsonb,
  token_ciphertext text,
  token_iv text,
  key_version smallint
)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Worker não autorizado.' using errcode = '42501';
  end if;
  if p_batch_size not between 1 and 25 then
    raise exception 'Tamanho de lote inválido.' using errcode = '22023';
  end if;

  update public.meta_campaigns campaign
  set status = 'running',
      started_at = coalesce(campaign.started_at, now()),
      failure_reason = null
  where campaign.id = p_campaign_id
    and campaign.status in ('queued', 'running');

  if not found then return; end if;

  return query
  with candidates as (
    select recipient.id
    from public.meta_campaign_recipients recipient
    where recipient.campaign_id = p_campaign_id
      and recipient.status = 'pending'
      and recipient.attempt_count < 3
      and coalesce(recipient.next_attempt_at, '-infinity'::timestamptz) <= now()
    order by recipient.created_at, recipient.id
    limit p_batch_size
    for update skip locked
  ), claimed as (
    update public.meta_campaign_recipients recipient
    set status = 'queued',
        attempt_count = recipient.attempt_count + 1,
        last_attempt_at = now(),
        processing_started_at = now(),
        processing_token = gen_random_uuid(),
        next_attempt_at = null
    from candidates
    where recipient.id = candidates.id
    returning recipient.*
  )
  select
    claimed.agency_id,
    campaign.id,
    campaign.connection_id,
    claimed.id,
    claimed.phone_e164,
    claimed.template_variables,
    claimed.attempt_count,
    claimed.processing_token,
    claimed.idempotency_key,
    connection.phone_number_id,
    template.name,
    template.language,
    template.parameters,
    credential.token_ciphertext,
    credential.token_iv,
    credential.key_version
  from claimed
  join public.meta_campaigns campaign
    on campaign.id = claimed.campaign_id and campaign.agency_id = claimed.agency_id
  join public.meta_connections connection
    on connection.id = campaign.connection_id and connection.agency_id = campaign.agency_id
  join public.meta_templates template
    on template.id = campaign.template_id and template.agency_id = campaign.agency_id
  join private.meta_connection_credentials credential
    on credential.connection_id = campaign.connection_id and credential.agency_id = campaign.agency_id;
end;
$$;

create or replace function public.record_meta_send_result(
  p_recipient_id uuid,
  p_processing_token uuid,
  p_success boolean,
  p_transient boolean,
  p_http_status integer,
  p_error_code text,
  p_error_message text,
  p_meta_message_id text,
  p_response_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_recipient public.meta_campaign_recipients;
  v_outcome text;
  v_next_attempt_at timestamptz;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Worker não autorizado.' using errcode = '42501';
  end if;
  select * into v_recipient
  from public.meta_campaign_recipients
  where id = p_recipient_id
    and status = 'queued'
    and processing_token = p_processing_token
  for update;
  if v_recipient.id is null then
    return jsonb_build_object('recorded', false, 'reason', 'stale_claim');
  end if;

  if p_success and nullif(p_meta_message_id, '') is null then
    raise exception 'A Meta não devolveu o wamid.' using errcode = '22023';
  end if;
  v_outcome := case
    when p_success then 'accepted'
    when p_transient and v_recipient.attempt_count < 3 then 'retry_scheduled'
    else 'failed'
  end;
  v_next_attempt_at := case v_recipient.attempt_count
    when 1 then now() + interval '2 seconds'
    when 2 then now() + interval '5 seconds'
    else null
  end;

  insert into public.meta_campaign_send_attempts (
    agency_id, campaign_id, recipient_id, attempt_number, attempted_at,
    outcome, is_transient, http_status, error_code, error_message,
    meta_message_id, response_metadata
  ) values (
    v_recipient.agency_id, v_recipient.campaign_id, v_recipient.id,
    v_recipient.attempt_count, v_recipient.last_attempt_at, v_outcome,
    p_transient, p_http_status, nullif(p_error_code, ''), nullif(p_error_message, ''),
    nullif(p_meta_message_id, ''), coalesce(p_response_metadata, '{}'::jsonb)
  );

  update public.meta_campaign_recipients
  set status = case
        when p_success then 'accepted'
        when v_outcome = 'retry_scheduled' then 'pending'
        else 'failed'
      end,
      meta_message_id = case when p_success then p_meta_message_id else meta_message_id end,
      accepted_at = case when p_success then now() else accepted_at end,
      sent_at = case when p_success then now() else sent_at end,
      failed_at = case when v_outcome = 'failed' then now() else null end,
      error_code = case when p_success then null else nullif(p_error_code, '') end,
      error_message = case when p_success then null else nullif(p_error_message, '') end,
      next_attempt_at = case when v_outcome = 'retry_scheduled' then v_next_attempt_at else null end,
      processing_token = null,
      processing_started_at = null
  where id = v_recipient.id;

  if p_success then
    insert into public.meta_delivery_events (
      agency_id, connection_id, campaign_id, recipient_id, meta_event_id,
      meta_message_id, event_type, event_metadata, occurred_at, event_fingerprint
    )
    select campaign.agency_id, campaign.connection_id, campaign.id, v_recipient.id,
      'accepted:' || p_meta_message_id, p_meta_message_id, 'accepted',
      jsonb_build_object('source', 'send_response'), now(), 'accepted:' || p_meta_message_id
    from public.meta_campaigns campaign where campaign.id = v_recipient.campaign_id
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'recorded', true,
    'outcome', v_outcome,
    'attemptNumber', v_recipient.attempt_count,
    'nextAttemptAt', v_next_attempt_at
  );
end;
$$;

create or replace function public.finalize_meta_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_campaign public.meta_campaigns;
  v_next_attempt_at timestamptz;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Worker não autorizado.' using errcode = '42501';
  end if;
  perform private.refresh_meta_campaign_progress(p_campaign_id);
  update public.meta_campaigns campaign
  set status = case when campaign.pending_count = 0 then 'completed' else campaign.status end,
      completed_at = case when campaign.pending_count = 0 then coalesce(campaign.completed_at, now()) else null end,
      failure_reason = case
        when campaign.pending_count = 0 and campaign.failed_count > 0
        then campaign.failed_count || ' destinatário(s) falharam. Consulte os resultados.'
        else null
      end
  where campaign.id = p_campaign_id
    and campaign.status in ('queued', 'running')
  returning * into v_campaign;
  select min(next_attempt_at) into v_next_attempt_at
  from public.meta_campaign_recipients
  where campaign_id = p_campaign_id and status = 'pending';
  return jsonb_build_object(
    'campaignId', v_campaign.id,
    'status', v_campaign.status,
    'total', v_campaign.total_count,
    'pending', v_campaign.pending_count,
    'successful', v_campaign.successful_count,
    'failed', v_campaign.failed_count,
    'nextAttemptAt', v_next_attempt_at
  );
end;
$$;

create or replace function public.record_meta_delivery_event(
  p_phone_number_id text,
  p_meta_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_error_code text,
  p_error_message text,
  p_event_fingerprint text,
  p_event_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_recipient public.meta_campaign_recipients;
  v_connection_id uuid;
  v_inserted_id uuid;
  v_current_rank smallint;
  v_event_rank smallint;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Webhook não autorizado.' using errcode = '42501';
  end if;
  if p_event_type not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'Status de entrega inválido.' using errcode = '22023';
  end if;

  select recipient.* into v_recipient
  from public.meta_campaign_recipients recipient
  join public.meta_campaigns campaign
    on campaign.id = recipient.campaign_id and campaign.agency_id = recipient.agency_id
  join public.meta_connections connection
    on connection.id = campaign.connection_id and connection.agency_id = campaign.agency_id
  where recipient.meta_message_id = p_meta_message_id
    and connection.phone_number_id = p_phone_number_id
  limit 1;
  if v_recipient.id is null then
    return jsonb_build_object('recorded', false, 'reason', 'recipient_not_found');
  end if;
  select connection_id into v_connection_id
  from public.meta_campaigns
  where id = v_recipient.campaign_id and agency_id = v_recipient.agency_id;

  insert into public.meta_delivery_events (
    agency_id, connection_id, campaign_id, recipient_id, meta_event_id,
    meta_message_id, event_type, event_metadata, occurred_at, event_fingerprint
  ) values (
    v_recipient.agency_id, v_connection_id, v_recipient.campaign_id, v_recipient.id,
    p_event_fingerprint, p_meta_message_id, p_event_type,
    coalesce(p_event_metadata, '{}'::jsonb), coalesce(p_occurred_at, now()), p_event_fingerprint
  )
  on conflict do nothing
  returning id into v_inserted_id;
  if v_inserted_id is null then
    return jsonb_build_object('recorded', false, 'reason', 'duplicate');
  end if;

  v_current_rank := private.meta_recipient_status_rank(v_recipient.status);
  v_event_rank := private.meta_recipient_status_rank(p_event_type);
  if v_event_rank >= v_current_rank then
    update public.meta_campaign_recipients
    set status = p_event_type,
        sent_at = case when p_event_type = 'sent' then coalesce(sent_at, p_occurred_at, now()) else sent_at end,
        delivered_at = case when p_event_type = 'delivered' then coalesce(delivered_at, p_occurred_at, now()) else delivered_at end,
        read_at = case when p_event_type = 'read' then coalesce(read_at, p_occurred_at, now()) else read_at end,
        failed_at = case when p_event_type = 'failed' then coalesce(failed_at, p_occurred_at, now()) else failed_at end,
        error_code = case when p_event_type = 'failed' then nullif(p_error_code, '') else error_code end,
        error_message = case when p_event_type = 'failed' then nullif(p_error_message, '') else error_message end
    where id = v_recipient.id;
  end if;
  return jsonb_build_object('recorded', true, 'recipientId', v_recipient.id, 'status', p_event_type);
end;
$$;

revoke all on function private.meta_recipient_status_rank(text) from public, anon, authenticated;
revoke all on function private.refresh_meta_campaign_progress(uuid) from public, anon, authenticated;
revoke all on function private.refresh_meta_campaign_progress_trigger() from public, anon, authenticated;
revoke all on function private.prevent_started_campaign_control() from public, anon, authenticated;
revoke all on function private.prevent_started_recipient_changes() from public, anon, authenticated;

revoke all on function public.claim_meta_campaign_batch(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_meta_send_result(uuid, uuid, boolean, boolean, integer, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_meta_campaign(uuid) from public, anon, authenticated;
revoke all on function public.record_meta_delivery_event(text, text, text, timestamptz, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.claim_meta_campaign_batch(uuid, integer) to service_role;
grant execute on function public.record_meta_send_result(uuid, uuid, boolean, boolean, integer, text, text, text, jsonb) to service_role;
grant execute on function public.finalize_meta_campaign(uuid) to service_role;
grant execute on function public.record_meta_delivery_event(text, text, text, timestamptz, text, text, text, jsonb) to service_role;
