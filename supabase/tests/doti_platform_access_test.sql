begin;

create extension if not exists pgtap;
select plan(31);

insert into auth.users (id, email)
values
  ('17000000-0000-4000-8000-000000000001', 'dot-admin@doti.test'),
  ('17000000-0000-4000-8000-000000000002', 'dot-member@doti.test'),
  ('17000000-0000-4000-8000-000000000003', 'dot-viewer@doti.test'),
  ('17000000-0000-4000-8000-000000000004', 'owner-a@platform.test'),
  ('17000000-0000-4000-8000-000000000005', 'owner-b@platform.test');

delete from public.profiles
where id in (
  '17000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000002',
  '17000000-0000-4000-8000-000000000003'
);
delete from public.agencies
where owner_id in (
  '17000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000002',
  '17000000-0000-4000-8000-000000000003'
);

insert into public.platform_staff (id, email, full_name, role)
values
  ('17000000-0000-4000-8000-000000000001', 'dot-admin@doti.test', 'Admin DOT', 'admin'),
  ('17000000-0000-4000-8000-000000000002', 'dot-member@doti.test', 'Membro DOT', 'member'),
  ('17000000-0000-4000-8000-000000000003', 'dot-viewer@doti.test', 'Viewer DOT', 'viewer');

insert into public.agencies (id, name, owner_id)
values
  ('27000000-0000-4000-8000-000000000001', 'Agência Plataforma A', '17000000-0000-4000-8000-000000000004'),
  ('27000000-0000-4000-8000-000000000002', 'Agência Plataforma B', '17000000-0000-4000-8000-000000000005');

update public.profiles p
set agency_id = fixture.agency_id,
    full_name = fixture.full_name,
    agency_name = fixture.agency_name,
    role = 'owner',
    is_active = true
from (
  values
    ('17000000-0000-4000-8000-000000000004'::uuid, '27000000-0000-4000-8000-000000000001'::uuid, 'Owner A', 'Agência Plataforma A'),
    ('17000000-0000-4000-8000-000000000005'::uuid, '27000000-0000-4000-8000-000000000002'::uuid, 'Owner B', 'Agência Plataforma B')
) as fixture(id, agency_id, full_name, agency_name)
where p.id = fixture.id;

delete from public.agencies
where owner_id in (
  '17000000-0000-4000-8000-000000000004',
  '17000000-0000-4000-8000-000000000005'
)
and id not in (
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000002'
);

insert into public.clients (id, agency_id, name, color)
values
  ('37000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', 'Cliente A', '#111111'),
  ('37000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000002', 'Cliente B', '#222222');

select has_column('public', 'agencies', 'status', 'agencies have an explicit lifecycle status');
select ok(
  not has_table_privilege('authenticated', 'public.platform_audit_events', 'SELECT'),
  'browser clients cannot query the internal audit table directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.platform_staff_invitations', 'SELECT'),
  'browser clients cannot query DOT invitations directly'
);
select is(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_account_context'
      and pg_get_function_identity_arguments(p.oid) = ''
  ),
  false,
  'account context executes with the caller privileges'
);
select has_index(
  'public', 'agencies', 'agencies_archived_by_idx',
  'archived agency actors have a covering foreign-key index'
);
select has_index(
  'public', 'platform_staff', 'platform_staff_created_by_idx',
  'platform staff creators have a covering foreign-key index'
);
select has_index(
  'public', 'platform_staff_invitations',
  'platform_staff_invitations_invited_by_idx',
  'platform invitations have a covering inviter index'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000001', true);
select set_config('request.headers', '{}', true);

select is((select count(*)::integer from public.platform_staff), 1, 'staff can only read their own DOT profile');
select is(private.current_agency_id(), null::uuid, 'pure DOT staff has no implicit customer agency');
select is(private.current_user_role(), null::text, 'pure DOT staff has no implicit operation role');

select set_config(
  'request.headers',
  '{"x-doti-agency-id":"27000000-0000-4000-8000-000000000002"}',
  true
);
select is(private.current_agency_id(), '27000000-0000-4000-8000-000000000002'::uuid, 'DOT admin can select an active support agency');
select is(private.current_user_role(), 'admin', 'DOT admin receives admin privileges in support context');
select is((select count(*)::integer from public.clients), 1, 'selected support context reads only the target agency');
select lives_ok(
  $$insert into public.clients (id, agency_id, name, color)
    values ('37000000-0000-4000-8000-000000000003', '27000000-0000-4000-8000-000000000002', 'Criado em suporte', '#333333')$$,
  'DOT admin can write in the selected agency'
);
reset role;
select ok(
  exists (
    select 1 from public.platform_audit_events
    where actor_id = '17000000-0000-4000-8000-000000000001'
      and agency_id = '27000000-0000-4000-8000-000000000002'
      and resource_type = 'clients'
  ),
  'support changes are audited with actor and agency'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000002', true);
select is(private.current_user_role(), 'member', 'DOT member receives the operational member role');
select lives_ok(
  $$insert into public.clients (id, agency_id, name, color)
    values ('37000000-0000-4000-8000-000000000004', '27000000-0000-4000-8000-000000000002', 'Cliente pelo membro', '#444444')$$,
  'DOT member can perform daily operation writes'
);
select throws_ok(
  $$insert into public.agency_groups (id, agency_id, name, initials)
    values ('47000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000002', 'Configuração', 'CF')$$,
  '42501', null,
  'DOT member cannot alter structural agency settings'
);

select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000003', true);
select is(private.current_user_role(), 'viewer', 'DOT viewer receives the read-only role');
select is((select count(*)::integer from public.clients), 3, 'DOT viewer can read the selected agency operation');
select throws_ok(
  $$insert into public.clients (agency_id, name, color)
    values ('27000000-0000-4000-8000-000000000002', 'Bloqueado', '#555555')$$,
  '42501', null,
  'DOT viewer cannot write operational data'
);

select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000004', true);
select is(private.current_agency_id(), '27000000-0000-4000-8000-000000000001'::uuid, 'customer cannot forge a DOT support context');
select is(private.current_user_role(), 'owner', 'forged support header does not change customer role');
select is((select count(*)::integer from public.clients), 1, 'customer remains isolated in their own agency');

select throws_ok(
  $$select public.platform_transfer_agency_owner(
    '27000000-0000-4000-8000-000000000001',
    '17000000-0000-4000-8000-000000000004',
    '17000000-0000-4000-8000-000000000001'
  )$$,
  '42501', null,
  'browser roles cannot call the owner transfer RPC'
);

reset role;
select ok(
  private.platform_actor_can_manage_agency(
    '17000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000002'
  ),
  'DOT admin is accepted by server-only Meta management checks'
);
select ok(
  not private.platform_actor_can_manage_agency(
    '17000000-0000-4000-8000-000000000002',
    '27000000-0000-4000-8000-000000000002'
  ),
  'DOT member is rejected by server-only Meta management checks'
);
select throws_ok(
  $$update public.platform_staff set is_active = false
    where id = '17000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'the last active DOT administrator cannot be disabled'
);

update public.agencies
set status = 'archived', archived_at = now()
where id = '27000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.headers',
  '{"x-doti-agency-id":"27000000-0000-4000-8000-000000000002"}',
  true
);
select is(private.current_agency_id(), null::uuid, 'archived agencies cannot be opened in support context');
select is(private.current_user_role(), null::text, 'archived agencies grant no operational role');
select ok(
  (public.get_account_context() -> 'platform' ->> 'role') = 'admin',
  'account context resolves the current DOT profile without exposing the directory'
);

select * from finish();
rollback;
