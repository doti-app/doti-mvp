alter table public.workflow_steps
  drop constraint if exists workflow_steps_agency_id_workflow_id_position_key;

alter table public.workflow_steps
  add constraint workflow_steps_agency_id_workflow_id_position_key
  unique (agency_id, workflow_id, position)
  deferrable initially deferred;

comment on constraint workflow_steps_agency_id_workflow_id_position_key on public.workflow_steps is
  'Keeps workflow step positions unique while allowing an atomic save to reorder existing steps.';
