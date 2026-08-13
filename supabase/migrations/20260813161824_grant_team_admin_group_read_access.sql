-- The team administration Edge Function needs only read access to validate and
-- list the groups that belong to an agency. Keep write privileges unavailable.

revoke insert, update, delete on table public.agency_groups from service_role;
grant select on table public.agency_groups to service_role;
