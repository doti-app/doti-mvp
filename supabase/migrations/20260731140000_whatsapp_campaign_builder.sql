-- Doti Goal 3: preparação atômica e confirmação segura de campanhas imediatas.

create or replace function public.save_meta_campaign_draft(
  p_campaign_id uuid,
  p_connection_id uuid,
  p_template_id uuid,
  p_name text,
  p_recipients jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_catalog
as $$
declare
  v_agency_id uuid := private.current_agency_id();
  v_user_id uuid := (select auth.uid());
  v_campaign_id uuid;
  v_template public.meta_templates;
  v_recipient jsonb;
  v_parameter jsonb;
  v_phone text;
  v_recipient_count integer;
begin
  if v_agency_id is null or v_user_id is null or not private.can_manage_operation() then
    raise exception 'Somente owner ou admin pode preparar campanhas.'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) not between 2 and 160 then
    raise exception 'Informe um nome de campanha entre 2 e 160 caracteres.'
      using errcode = '22023';
  end if;
  if p_recipients is null or coalesce(jsonb_typeof(p_recipients), 'null') <> 'array' then
    raise exception 'A lista de destinatários é inválida.'
      using errcode = '22023';
  end if;

  v_recipient_count := jsonb_array_length(p_recipients);
  if v_recipient_count < 1 then
    raise exception 'Adicione ao menos um destinatário válido.'
      using errcode = '22023';
  end if;
  if v_recipient_count > 100 then
    raise exception 'Campanhas podem ter no máximo 100 contatos. Divida a lista e tente novamente.'
      using errcode = '22023';
  end if;

  select template.* into v_template
  from public.meta_templates template
  where template.id = p_template_id
    and template.agency_id = v_agency_id
    and template.connection_id = p_connection_id
    and template.status = 'approved';
  if v_template.id is null then
    raise exception 'Selecione um template aprovado desta agência e conexão.'
      using errcode = '23514';
  end if;

  if (
    select count(*) <> count(distinct item ->> 'phone')
    from jsonb_array_elements(p_recipients) item
  ) then
    raise exception 'A lista contém números duplicados.'
      using errcode = '22023';
  end if;

  for v_recipient in select value from jsonb_array_elements(p_recipients)
  loop
    if coalesce(jsonb_typeof(v_recipient), 'null') <> 'object'
       or coalesce(jsonb_typeof(v_recipient -> 'variables'), 'null') <> 'object' then
      raise exception 'Um destinatário possui formato inválido.'
        using errcode = '22023';
    end if;
    v_phone := v_recipient ->> 'phone';
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'Um destinatário possui número inválido.'
        using errcode = '22023';
    end if;
    for v_parameter in
      select value from jsonb_array_elements(coalesce(v_template.parameters, '[]'::jsonb))
    loop
      if nullif(btrim(v_recipient -> 'variables' ->> (v_parameter ->> 'name')), '') is null then
        raise exception 'A variável obrigatória "%" não foi preenchida para todos os destinatários.',
          v_parameter ->> 'name'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  if p_campaign_id is null then
    insert into public.meta_campaigns (
      agency_id, connection_id, template_id, name, status
    ) values (
      v_agency_id, p_connection_id, p_template_id, btrim(p_name), 'draft'
    ) returning id into v_campaign_id;
  else
    update public.meta_campaigns
    set connection_id = p_connection_id,
        template_id = p_template_id,
        name = btrim(p_name),
        failure_reason = null
    where id = p_campaign_id
      and agency_id = v_agency_id
      and status = 'draft'
    returning id into v_campaign_id;
    if v_campaign_id is null then
      raise exception 'O rascunho não está disponível para edição.'
        using errcode = 'P0002';
    end if;
    delete from public.meta_campaign_recipients
    where agency_id = v_agency_id and campaign_id = v_campaign_id;
  end if;

  insert into public.meta_campaign_recipients (
    agency_id, campaign_id, phone_e164, template_variables
  )
  select
    v_agency_id,
    v_campaign_id,
    item ->> 'phone',
    coalesce(item -> 'variables', '{}'::jsonb)
  from jsonb_array_elements(p_recipients) item;

  return jsonb_build_object(
    'campaignId', v_campaign_id,
    'recipientCount', v_recipient_count,
    'status', 'draft'
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
  v_campaign public.meta_campaigns;
  v_template public.meta_templates;
  v_recipient_count integer;
begin
  if v_agency_id is null or not private.can_manage_operation() then
    raise exception 'Somente owner ou admin pode disparar campanhas.'
      using errcode = '42501';
  end if;

  select campaign.* into v_campaign
  from public.meta_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.agency_id = v_agency_id
    and campaign.status in ('draft', 'failed');
  if v_campaign.id is null then
    raise exception 'Campanha indisponível para disparo.'
      using errcode = 'P0002';
  end if;

  select template.* into v_template
  from public.meta_templates template
  where template.id = v_campaign.template_id
    and template.agency_id = v_agency_id
    and template.connection_id = v_campaign.connection_id
    and template.status = 'approved';
  if v_template.id is null then
    raise exception 'O template não está aprovado e disponível para esta conexão.'
      using errcode = '23514';
  end if;

  select count(*)::integer into v_recipient_count
  from public.meta_campaign_recipients recipient
  where recipient.agency_id = v_agency_id
    and recipient.campaign_id = v_campaign.id
    and recipient.status = 'pending';
  if v_recipient_count < 1 then
    raise exception 'A campanha não possui destinatários válidos pendentes.'
      using errcode = '22023';
  end if;
  if v_recipient_count > 100 then
    raise exception 'Campanhas podem ter no máximo 100 contatos. Divida a lista e tente novamente.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.meta_campaign_recipients recipient
    cross join lateral jsonb_array_elements(coalesce(v_template.parameters, '[]'::jsonb)) parameter
    where recipient.agency_id = v_agency_id
      and recipient.campaign_id = v_campaign.id
      and nullif(btrim(recipient.template_variables ->> (parameter ->> 'name')), '') is null
  ) then
    raise exception 'Há variáveis obrigatórias sem valor na campanha.'
      using errcode = '22023';
  end if;

  update public.meta_campaigns
  set status = 'queued',
      queued_at = now(),
      failure_reason = null
  where id = v_campaign.id and agency_id = v_agency_id;
  return v_campaign.id;
end;
$$;

revoke all on function public.save_meta_campaign_draft(uuid, uuid, uuid, text, jsonb)
  from public, anon;
grant execute on function public.save_meta_campaign_draft(uuid, uuid, uuid, text, jsonb)
  to authenticated;

revoke all on function public.queue_meta_campaign(uuid) from public, anon;
grant execute on function public.queue_meta_campaign(uuid) to authenticated;
