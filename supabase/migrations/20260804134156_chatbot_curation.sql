create table public.chatbot_integrations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  source_key text not null unique check (source_key ~ '^[a-z0-9][a-z0-9_-]{7,79}$'),
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chatbot_interactions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  integration_id uuid not null references public.chatbot_integrations(id) on delete cascade,
  external_event_id text not null check (char_length(external_event_id) between 1 and 200),
  occurred_at timestamptz not null,
  question text not null check (char_length(question) between 1 and 20000),
  answer text not null check (char_length(answer) between 1 and 50000),
  channel text not null default 'web' check (char_length(channel) between 1 and 40),
  external_user_id text check (external_user_id is null or char_length(external_user_id) <= 200),
  source_url text check (source_url is null or char_length(source_url) <= 2048),
  response_time_ms integer check (response_time_ms is null or response_time_ms between 0 and 600000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'needs_review', 'rejected')),
  rating smallint check (rating is null or rating between 1 and 5),
  categories text[] not null default '{}' check (
    cardinality(categories) <= 12
    and char_length(array_to_string(categories, ',')) <= 1000
  ),
  review_notes text check (review_notes is null or char_length(review_notes) <= 5000),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, external_event_id),
  check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

create index chatbot_integrations_agency_idx on public.chatbot_integrations(agency_id);
create index chatbot_integrations_created_by_idx on public.chatbot_integrations(created_by);
create index chatbot_interactions_agency_date_idx on public.chatbot_interactions(agency_id, occurred_at desc);
create index chatbot_interactions_agency_status_idx on public.chatbot_interactions(agency_id, status, occurred_at desc);
create index chatbot_interactions_reviewed_by_idx on public.chatbot_interactions(reviewed_by);

create trigger chatbot_integrations_set_updated_at
before update on public.chatbot_integrations
for each row execute function private.set_updated_at();

create trigger chatbot_interactions_set_updated_at
before update on public.chatbot_interactions
for each row execute function private.set_updated_at();

alter table public.chatbot_integrations enable row level security;
alter table public.chatbot_interactions enable row level security;

create policy "Agency members can read chatbot integrations"
on public.chatbot_integrations for select to authenticated
using (agency_id = private.current_agency_id());

create policy "Managers can create chatbot integrations"
on public.chatbot_integrations for insert to authenticated
with check (
  agency_id = private.current_agency_id()
  and private.can_manage_operation()
  and created_by = (select auth.uid())
);

create policy "Managers can update chatbot integrations"
on public.chatbot_integrations for update to authenticated
using (agency_id = private.current_agency_id() and private.can_manage_operation())
with check (agency_id = private.current_agency_id() and private.can_manage_operation());

create policy "Managers can delete chatbot integrations"
on public.chatbot_integrations for delete to authenticated
using (agency_id = private.current_agency_id() and private.can_manage_operation());

create policy "Agency members can read chatbot interactions"
on public.chatbot_interactions for select to authenticated
using (agency_id = private.current_agency_id());

create policy "Writers can curate chatbot interactions"
on public.chatbot_interactions for update to authenticated
using (agency_id = private.current_agency_id() and private.can_write_operation())
with check (
  agency_id = private.current_agency_id()
  and private.can_write_operation()
  and (reviewed_by is null or reviewed_by = (select auth.uid()))
);

revoke all on public.chatbot_integrations, public.chatbot_interactions from public, anon, authenticated;
grant select (id, agency_id, name, source_key, is_active, created_by, created_at, updated_at)
  on public.chatbot_integrations to authenticated;
grant insert (agency_id, name, source_key, secret_hash, is_active, created_by)
  on public.chatbot_integrations to authenticated;
grant update (name, source_key, secret_hash, is_active)
  on public.chatbot_integrations to authenticated;
grant delete on public.chatbot_integrations to authenticated;

grant select on public.chatbot_interactions to authenticated;
grant update (status, rating, categories, review_notes, reviewed_by, reviewed_at)
  on public.chatbot_interactions to authenticated;

grant select, insert, update, delete on public.chatbot_integrations, public.chatbot_interactions to service_role;

alter table public.chatbot_interactions replica identity full;
