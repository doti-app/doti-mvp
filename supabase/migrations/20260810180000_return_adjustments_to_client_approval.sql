-- A etapa "Ajustes" é um desvio de uma aprovação recusada. Ao concluí-la,
-- a demanda deve voltar à mesma etapa do cliente para uma nova decisão, e não
-- prosseguir diretamente para a próxima etapa (por exemplo, Entrega final).
create or replace function private.return_adjustments_to_client_approval()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_adjustment_step_id uuid;
  v_approval_step_id uuid;
  v_latest_decision text;
  v_latest_target_position integer;
begin
  if old.current_step_position < 1
     or new.current_step_position <> old.current_step_position + 1 then
    return new;
  end if;

  select adjustment_step.id, approval_step.id
  into v_adjustment_step_id, v_approval_step_id
  from public.deliverable_steps adjustment_step
  join public.deliverable_steps approval_step
    on approval_step.agency_id = adjustment_step.agency_id
   and approval_step.deliverable_id = adjustment_step.deliverable_id
   and approval_step.position = adjustment_step.position - 1
  join public.agency_groups approval_group
    on approval_group.agency_id = approval_step.agency_id
   and approval_group.id = approval_step.group_id
   and approval_group.is_client_group
  where adjustment_step.agency_id = old.agency_id
    and adjustment_step.deliverable_id = old.id
    and adjustment_step.position = old.current_step_position
    and adjustment_step.name ~* '(^|[^[:alnum:]])ajustes?([^[:alnum:]]|$)';

  if v_adjustment_step_id is null then
    return new;
  end if;

  select decision.decision, decision.to_step_position
  into v_latest_decision, v_latest_target_position
  from public.client_approval_decisions decision
  where decision.agency_id = old.agency_id
    and decision.deliverable_id = old.id
    and decision.deliverable_step_id = v_approval_step_id
  order by decision.decided_at desc
  limit 1;

  if v_latest_decision = 'rejected'
     and v_latest_target_position = old.current_step_position then
    new.current_step_position := old.current_step_position - 1;
    new.status := 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists return_adjustments_to_client_approval on public.deliverables;
create trigger return_adjustments_to_client_approval
before update of current_step_position, status on public.deliverables
for each row execute function private.return_adjustments_to_client_approval();

revoke all on function private.return_adjustments_to_client_approval() from public, anon, authenticated;
