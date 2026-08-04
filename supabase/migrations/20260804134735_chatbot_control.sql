create table public.chatbots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(trim(name)) between 2 and 80),
  color text not null default '#ffd400' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  foreign key (agency_id, client_id)
    references public.clients(agency_id, id)
    on delete set null (client_id)
);

alter table public.chatbot_integrations
add column bot_id uuid;

insert into public.chatbots (id, agency_id, name, color, is_active, created_by, created_at, updated_at)
select
  integration.id,
  integration.agency_id,
  case
    when integration.name = 'Virgulinha Web' then 'Virgulinha'
    else integration.name
  end,
  '#ffd400',
  integration.is_active,
  integration.created_by,
  integration.created_at,
  integration.updated_at
from public.chatbot_integrations integration;

update public.chatbot_integrations
set bot_id = id;

alter table public.chatbot_integrations
alter column bot_id set not null,
add constraint chatbot_integrations_agency_bot_fkey
  foreign key (agency_id, bot_id)
  references public.chatbots(agency_id, id)
  on delete cascade;

create index chatbots_agency_name_idx on public.chatbots(agency_id, name);
create index chatbots_client_idx on public.chatbots(agency_id, client_id);
create index chatbot_integrations_bot_idx on public.chatbot_integrations(agency_id, bot_id);

create trigger chatbots_set_updated_at
before update on public.chatbots
for each row execute function private.set_updated_at();

alter table public.chatbots enable row level security;

create policy "Agency members can read chatbots"
on public.chatbots for select to authenticated
using (agency_id = private.current_agency_id());

create policy "Managers can create chatbots"
on public.chatbots for insert to authenticated
with check (
  agency_id = private.current_agency_id()
  and private.can_manage_operation()
  and created_by = (select auth.uid())
);

create policy "Managers can update chatbots"
on public.chatbots for update to authenticated
using (agency_id = private.current_agency_id() and private.can_manage_operation())
with check (agency_id = private.current_agency_id() and private.can_manage_operation());

create policy "Managers can delete chatbots"
on public.chatbots for delete to authenticated
using (agency_id = private.current_agency_id() and private.can_manage_operation());

revoke all on public.chatbots from public, anon, authenticated;
grant select (id, agency_id, client_id, name, color, is_active, created_by, created_at, updated_at)
  on public.chatbots to authenticated;
grant insert (agency_id, client_id, name, color, is_active, created_by)
  on public.chatbots to authenticated;
grant update (client_id, name, color, is_active)
  on public.chatbots to authenticated;
grant delete on public.chatbots to authenticated;
grant select, insert, update, delete on public.chatbots to service_role;

grant select (bot_id) on public.chatbot_integrations to authenticated;
grant insert (bot_id) on public.chatbot_integrations to authenticated;

alter table public.chatbots replica identity full;
