-- Permite que a Edge Function interna componha o resumo global sem ampliar
-- o acesso dos clientes autenticados nem conceder escrita ao service_role.
grant select on table
  public.projects,
  public.deliverables,
  public.activity_events
to service_role;
