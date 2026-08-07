-- Doti Goal 6: invariantes explícitos dos limites operacionais da V1.

create unique index meta_connections_one_live_per_agency_idx
  on public.meta_connections(agency_id)
  where status in ('active', 'attention');

comment on index public.meta_connections_one_live_per_agency_idx is
  'A V1 aceita uma única conexão utilizável por agência; desconectadas permanecem apenas para histórico.';

alter table public.meta_campaigns
  add constraint meta_campaigns_v1_immediate_only
  check (
    status not in ('scheduled', 'cancelled')
    and scheduled_at is null
  );

comment on constraint meta_campaigns_v1_immediate_only on public.meta_campaigns is
  'A V1 permite somente disparo imediato e não oferece agendamento ou cancelamento.';
