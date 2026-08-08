-- Cover the composite foreign keys introduced by the client approvals ledger.
-- These indexes keep parent-row updates/deletes and approval-history lookups fast.
create index if not exists client_approval_decisions_project_fk_idx
  on public.client_approval_decisions(agency_id, project_id);

create index if not exists client_approval_decisions_step_fk_idx
  on public.client_approval_decisions(agency_id, deliverable_step_id);
