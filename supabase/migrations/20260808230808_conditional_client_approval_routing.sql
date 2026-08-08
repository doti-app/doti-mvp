-- Aprovações devem pular uma etapa chamada "Ajustes"; essa etapa é usada
-- exclusivamente quando o cliente solicita alterações.
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
  v_next_is_adjustment boolean := false;
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

  select coalesce(
    step_row.name ~* '(^|[^[:alnum:]])ajustes?([^[:alnum:]]|$)',
    false
  )
  into v_next_is_adjustment
  from public.deliverable_steps step_row
  where step_row.agency_id = v_agency_id
    and step_row.deliverable_id = p_deliverable_id
    and step_row.position = v_step_position + 1;

  if p_decision = 'approved' then
    v_target_position := v_step_position + 1
      + case when v_next_is_adjustment then 1 else 0 end;

    if v_target_position > v_max_step_position then
      v_target_position := null;
      v_status := 'done';
      update public.deliverables
      set status = 'done'
      where agency_id = v_agency_id and id = p_deliverable_id;
    else
      update public.deliverables
      set current_step_position = v_target_position,
          status = 'active'
      where agency_id = v_agency_id and id = p_deliverable_id;
    end if;
  else
    if v_next_is_adjustment then
      v_target_position := v_step_position + 1;
    else
      if v_step_position = 0 then
        raise exception 'Não existe uma etapa anterior para receber os ajustes.'
          using errcode = '23514';
      end if;
      v_target_position := v_step_position - 1;
    end if;
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
