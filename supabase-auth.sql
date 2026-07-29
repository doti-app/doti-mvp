-- Execute este arquivo uma vez no SQL Editor do projeto Supabase da Doti.

create extension if not exists pgcrypto;

create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  email text not null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  agency_name text not null check (char_length(agency_name) between 2 and 120),
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_agency_id_idx on public.profiles(agency_id);
create unique index if not exists profiles_email_unique_idx on public.profiles(lower(email));

alter table public.agencies enable row level security;
alter table public.profiles enable row level security;

create or replace function public.current_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select agency_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

drop policy if exists "Members can view their agency" on public.agencies;
create policy "Members can view their agency"
on public.agencies for select
to authenticated
using (id = public.current_agency_id());

drop policy if exists "Owners and admins can update their agency" on public.agencies;
create policy "Owners and admins can update their agency"
on public.agencies for update
to authenticated
using (
  id = public.current_agency_id()
  and public.current_user_role() in ('owner', 'admin')
)
with check (
  id = public.current_agency_id()
  and public.current_user_role() in ('owner', 'admin')
);

drop policy if exists "Members can view agency profiles" on public.profiles;
create policy "Members can view agency profiles"
on public.profiles for select
to authenticated
using (agency_id = public.current_agency_id());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and agency_id = public.current_agency_id()
  and role = public.current_user_role()
);

create or replace function public.handle_new_doti_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_agency_id uuid;
  new_full_name text;
  new_agency_name text;
begin
  new_full_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  new_agency_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'agency_name'), ''), 'Minha agência');

  insert into public.agencies (name, owner_id)
  values (new_agency_name, new.id)
  returning id into new_agency_id;

  insert into public.profiles (id, agency_id, email, full_name, agency_name, role)
  values (new.id, new_agency_id, new.email, new_full_name, new_agency_name, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_doti_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agencies_set_updated_at on public.agencies;
create trigger agencies_set_updated_at
before update on public.agencies
for each row execute procedure public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

grant usage on schema public to authenticated;
revoke all on function public.current_agency_id() from public, anon;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.handle_new_doti_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.current_agency_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant select, update on public.agencies to authenticated;
grant select, update on public.profiles to authenticated;
