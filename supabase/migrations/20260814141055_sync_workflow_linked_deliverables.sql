alter table public.deliverable_steps
  drop constraint if exists deliverable_steps_agency_id_deliverable_id_position_key;

alter table public.deliverable_steps
  add constraint deliverable_steps_agency_id_deliverable_id_position_key
  unique (agency_id, deliverable_id, position)
  deferrable initially deferred;

comment on constraint deliverable_steps_agency_id_deliverable_id_position_key on public.deliverable_steps is
  'Keeps demand step positions unique while allowing an atomic workflow sync to reorder existing steps.';

alter table public.step_tasks
  drop constraint if exists step_tasks_agency_id_deliverable_step_id_position_key;

alter table public.step_tasks
  add constraint step_tasks_agency_id_deliverable_step_id_position_key
  unique (agency_id, deliverable_step_id, position)
  deferrable initially deferred;

comment on constraint step_tasks_agency_id_deliverable_step_id_position_key on public.step_tasks is
  'Keeps task positions unique while allowing tasks to move atomically between reordered demand steps.';

alter table public.client_workspace_blocks
  drop constraint if exists client_workspace_blocks_agency_id_client_id_position_key;

alter table public.client_workspace_blocks
  add constraint client_workspace_blocks_agency_id_client_id_position_key
  unique (agency_id, client_id, position)
  deferrable initially deferred;

comment on constraint client_workspace_blocks_agency_id_client_id_position_key on public.client_workspace_blocks is
  'Keeps workspace block positions unique while allowing atomic snapshot reordering.';

do $migration$
declare
  v_definition text;
  v_old_clause constant text := E'on conflict (id) do update set\n          title = excluded.title, done = excluded.done, position = excluded.position';
  v_new_clause constant text := E'on conflict (id) do update set\n          deliverable_step_id = excluded.deliverable_step_id,\n          title = excluded.title, done = excluded.done, position = excluded.position';
begin
  v_definition := pg_get_functiondef('public.save_agency_state(jsonb,bigint)'::regprocedure);

  if strpos(v_definition, v_new_clause) > 0 then
    return;
  end if;

  if strpos(v_definition, v_old_clause) = 0 then
    raise exception 'The step task upsert clause in save_agency_state was not found';
  end if;

  execute replace(v_definition, v_old_clause, v_new_clause);
end;
$migration$;
