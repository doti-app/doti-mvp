-- Permite que a função team-admin valide o cliente associado a um convite.
-- A função usa a chave de serviço somente para consultas administrativas.
grant select on table public.clients to service_role;
