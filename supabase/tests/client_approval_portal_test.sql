begin;

create extension if not exists pgtap;
select plan(43);

insert into auth.users (id, email)
values
  ('18000000-0000-4000-8000-000000000001', 'approval-owner@doti.test'),
  ('18000000-0000-4000-8000-000000000002', 'approval-admin@doti.test'),
  ('18000000-0000-4000-8000-000000000003', 'approval-member@doti.test'),
  ('18000000-0000-4000-8000-000000000004', 'approval-viewer@doti.test'),
  ('18000000-0000-4000-8000-000000000005', 'approval-client-a@doti.test'),
  ('18000000-0000-4000-8000-000000000006', 'approval-client-b@doti.test'),
  ('18000000-0000-4000-8000-000000000007', 'approval-support@doti.test'),
  ('18000000-0000-4000-8000-000000000008', 'approval-owner-b@doti.test');

insert into public.agencies (id, name, owner_id)
values
  ('28000000-0000-4000-8000-000000000001', 'Agência Aprovações', '18000000-0000-4000-8000-000000000001'),
  ('28000000-0000-4000-8000-000000000002', 'Agência Externa', '18000000-0000-4000-8000-000000000008');

update public.profiles p
set agency_id = '28000000-0000-4000-8000-000000000001',
    agency_name = 'Agência Aprovações',
    full_name = fixture.full_name,
    role = fixture.role,
    is_active = true
from (
  values
    ('18000000-0000-4000-8000-000000000001'::uuid, 'Owner Aprovações', 'owner'),
    ('18000000-0000-4000-8000-000000000002'::uuid, 'Admin Aprovações', 'admin'),
    ('18000000-0000-4000-8000-000000000003'::uuid, 'Member Aprovações', 'member'),
    ('18000000-0000-4000-8000-000000000004'::uuid, 'Viewer Aprovações', 'viewer'),
    ('18000000-0000-4000-8000-000000000005'::uuid, 'Cliente A — Ana', 'member'),
    ('18000000-0000-4000-8000-000000000006'::uuid, 'Cliente B — Beto', 'member')
) as fixture(id, full_name, role)
where p.id = fixture.id;

update public.profiles
set agency_id = '28000000-0000-4000-8000-000000000002',
    agency_name = 'Agência Externa',
    full_name = 'Owner Externo',
    role = 'owner',
    is_active = true
where id = '18000000-0000-4000-8000-000000000008';

delete from public.profiles
where id = '18000000-0000-4000-8000-000000000007';
delete from public.agencies
where owner_id = '18000000-0000-4000-8000-000000000007';

insert into public.platform_staff (id, email, full_name, role)
values (
  '18000000-0000-4000-8000-000000000007',
  'approval-support@doti.test',
  'Suporte DOTI',
  'admin'
);

delete from public.agencies
where id not in (
    '28000000-0000-4000-8000-000000000001',
    '28000000-0000-4000-8000-000000000002'
  )
  and owner_id in (
    '18000000-0000-4000-8000-000000000001',
    '18000000-0000-4000-8000-000000000002',
    '18000000-0000-4000-8000-000000000003',
    '18000000-0000-4000-8000-000000000004',
    '18000000-0000-4000-8000-000000000005',
    '18000000-0000-4000-8000-000000000006',
    '18000000-0000-4000-8000-000000000008'
  );

insert into public.agency_operation_state (agency_id, revision)
values ('28000000-0000-4000-8000-000000000001', 0);

insert into public.clients (id, agency_id, name, color, position)
values
  ('38000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', 'Cliente A', '#ffd400', 0),
  ('38000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000001', 'Cliente B', '#b8e1ff', 1),
  ('38000000-0000-4000-8000-000000000003', '28000000-0000-4000-8000-000000000002', 'Cliente Externo', '#111111', 0);

update public.profiles p
set agency_id = '28000000-0000-4000-8000-000000000001',
    agency_name = 'Agência Aprovações',
    full_name = fixture.full_name,
    role = 'client',
    client_id = fixture.client_id,
    is_active = true
from (
  values
    ('18000000-0000-4000-8000-000000000005'::uuid, 'Cliente A — Ana', '38000000-0000-4000-8000-000000000001'::uuid),
    ('18000000-0000-4000-8000-000000000006'::uuid, 'Cliente B — Beto', '38000000-0000-4000-8000-000000000002'::uuid)
) as fixture(id, full_name, client_id)
where p.id = fixture.id;

insert into public.agency_groups (id, agency_id, name, initials, position)
values
  ('48000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', 'Produção', 'PR', 0),
  ('48000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000001', 'Cliente / Atendimento', 'CL', 1);

insert into public.workflows (id, agency_id, name, category)
values ('58000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', 'Fluxo de teste', 'Design');

insert into public.projects (id, agency_id, client_id, name, due_date, position)
values
  ('68000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', 'Projeto A', current_date + 10, 0),
  ('68000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000002', 'Projeto B', current_date + 12, 1);

insert into public.deliverables (
  id, agency_id, project_id, name, category, current_step_position, position
)
values
  ('78000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'Entrega para aprovar', 'Design', 1, 0),
  ('78000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'Entrega para reprovar', 'Design', 1, 1),
  ('78000000-0000-4000-8000-000000000003', '28000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', 'Entrega do owner', 'Design', 1, 2),
  ('78000000-0000-4000-8000-000000000004', '28000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', 'Entrega do admin', 'Design', 1, 3),
  ('78000000-0000-4000-8000-000000000005', '28000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', 'Entrega do suporte', 'Design', 1, 4);

insert into public.deliverable_steps (
  id, agency_id, deliverable_id, group_id, name, position
)
select
  ('88000000-0000-4000-8000-' || lpad(deliverable_number::text, 10, '0') || '01')::uuid,
  '28000000-0000-4000-8000-000000000001'::uuid,
  ('78000000-0000-4000-8000-' || lpad(deliverable_number::text, 12, '0'))::uuid,
  '48000000-0000-4000-8000-000000000001'::uuid,
  'Produção',
  0
from generate_series(1, 5) deliverable_number;

insert into public.deliverable_steps (
  id, agency_id, deliverable_id, group_id, name, position
)
select
  ('88000000-0000-4000-8000-' || lpad(deliverable_number::text, 10, '0') || '02')::uuid,
  '28000000-0000-4000-8000-000000000001'::uuid,
  ('78000000-0000-4000-8000-' || lpad(deliverable_number::text, 12, '0'))::uuid,
  '48000000-0000-4000-8000-000000000002'::uuid,
  'Aprovação do cliente',
  1
from generate_series(1, 5) deliverable_number;

insert into public.deliverable_steps (
  id, agency_id, deliverable_id, group_id, name, position
)
values (
  '88000000-0000-4000-8000-000000000103',
  '28000000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000001',
  'Entrega',
  2
);

insert into public.files (
  id, agency_id, deliverable_id, kind, storage_path, name, mime_type, position
)
values
  ('98000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', 'deliverable_attachment', '28000000-0000-4000-8000-000000000001/deliverables/a.pdf', 'a.pdf', 'application/pdf', 0),
  ('98000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000003', 'deliverable_attachment', '28000000-0000-4000-8000-000000000001/deliverables/b.pdf', 'b.pdf', 'application/pdf', 0);

insert into storage.objects (id, bucket_id, name, owner)
values
  ('99000000-0000-4000-8000-000000000001', 'doti-files', '28000000-0000-4000-8000-000000000001/deliverables/a.pdf', '18000000-0000-4000-8000-000000000001'),
  ('99000000-0000-4000-8000-000000000002', 'doti-files', '28000000-0000-4000-8000-000000000001/deliverables/b.pdf', '18000000-0000-4000-8000-000000000001');

select has_column('public', 'profiles', 'client_id', 'profiles link customer accounts to one client');
select has_column('public', 'team_invitations', 'client_id', 'invitations preserve the client assignment');
select has_column('public', 'agency_groups', 'is_client_group', 'agency groups identify customer action stages explicitly');
select has_table('public', 'client_approval_decisions', 'approval decisions have their own audit table');
select ok(
  (select is_client_group from public.agency_groups where id = '48000000-0000-4000-8000-000000000002'),
  'the legacy customer group name is marked automatically'
);
select is(
  (select count(*)::integer from public.agency_groups where agency_id = '28000000-0000-4000-8000-000000000001' and is_client_group),
  1,
  'an agency has a single customer group'
);
select throws_ok(
  $$insert into public.workflow_steps (agency_id, workflow_id, group_id, name, position)
    values (
      '28000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000001',
      '48000000-0000-4000-8000-000000000002',
      'Aprovação inválida',
      0
    )$$,
  '23514', null,
  'the customer group cannot be the first workflow stage'
);
select throws_ok(
  $$update public.profiles
    set client_id = '38000000-0000-4000-8000-000000000003'
    where id = '18000000-0000-4000-8000-000000000005'$$,
  '23503', null,
  'a customer profile cannot link to a client from another agency'
);

set local role authenticated;
select set_config('request.headers', '{}', true);
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000005', true);

select is((select count(*)::integer from public.profiles), 1, 'customer can only read their own profile');
select is((select count(*)::integer from public.clients), 0, 'customer cannot query the client directory');
select is((select count(*)::integer from public.projects), 0, 'customer cannot query project state directly');
select is((select count(*)::integer from public.deliverables), 0, 'customer cannot query deliverables directly');
select is((select count(*)::integer from public.files), 0, 'customer cannot query file metadata directly');
select is(
  jsonb_array_length(public.load_client_approval_queue() -> 'items'),
  2,
  'customer queue includes only their pending approvals'
);
select ok(
  (select bool_and((item ->> 'clientId')::uuid = '38000000-0000-4000-8000-000000000001')
   from jsonb_array_elements(public.load_client_approval_queue() -> 'items') item),
  'every queued approval belongs to the linked client'
);
select is((select count(*)::integer from storage.objects), 1, 'customer can download only attachments from their projects');
select throws_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000003',
    '88000000-0000-4000-8000-000000000302',
    'approved',
    ''
  )$$,
  '42501', null,
  'customer cannot decide another client approval'
);
select throws_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000002',
    '88000000-0000-4000-8000-000000000202',
    'rejected',
    ''
  )$$,
  '23514', null,
  'rejection requires a comment'
);
select lives_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000002',
    '88000000-0000-4000-8000-000000000202',
    'rejected',
    'Ajustar o contraste'
  )$$,
  'customer can reject their current approval with a comment'
);
select is(
  jsonb_array_length(public.load_client_approval_queue() -> 'items'),
  1,
  'rejected approval leaves the customer queue'
);
select is(
  (select count(*)::integer from public.step_tasks where deliverable_step_id = '88000000-0000-4000-8000-000000000201'),
  0,
  'customer cannot inspect the internal adjustment task directly'
);
select lives_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000102',
    'approved',
    'Tudo certo'
  )$$,
  'customer can approve their current stage'
);
select is(
  jsonb_array_length(public.load_client_approval_queue() -> 'items'),
  0,
  'approved and rejected items leave the customer queue'
);
select throws_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000102',
    'approved',
    ''
  )$$,
  '40001', null,
  'a stale approval stage cannot be decided twice'
);
select is((select count(*)::integer from public.client_approval_decisions), 2, 'customer reads only their own immutable decision history');

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000006', true);
select ok(
  (select bool_and((item ->> 'clientId')::uuid = '38000000-0000-4000-8000-000000000002')
   from jsonb_array_elements(public.load_client_approval_queue() -> 'items') item),
  'a second customer is isolated from the first customer queue'
);
select is((select count(*)::integer from storage.objects), 1, 'a second customer sees only their own attachment');

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000003', true);
select is(public.load_client_approval_queue() ->> 'canDecide', 'false', 'member can follow approvals in read-only mode');
select throws_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000003',
    '88000000-0000-4000-8000-000000000302',
    'approved',
    ''
  )$$,
  '42501', null,
  'member cannot decide approvals'
);

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000003',
    '88000000-0000-4000-8000-000000000302',
    'approved',
    ''
  )$$,
  '42501', null,
  'viewer cannot decide approvals'
);

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000003',
    '88000000-0000-4000-8000-000000000302',
    'approved',
    ''
  )$$,
  'owner can decide any agency approval'
);
select is((select status from public.deliverables where id = '78000000-0000-4000-8000-000000000003'), 'done', 'approval at the final stage completes the deliverable');

select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000004',
    '88000000-0000-4000-8000-000000000402',
    'approved',
    ''
  )$$,
  'admin can decide any agency approval'
);
select is((select status from public.deliverables where id = '78000000-0000-4000-8000-000000000004'), 'done', 'admin final approval completes the deliverable');

reset role;
select is(
  (select current_step_position from public.deliverables where id = '78000000-0000-4000-8000-000000000002'),
  0,
  'rejection returns the deliverable to the immediately previous stage'
);
select is(
  (select count(*)::integer from public.step_tasks where deliverable_step_id = '88000000-0000-4000-8000-000000000201'),
  1,
  'rejection creates one internal adjustment task in the previous stage'
);
select throws_ok(
  $$update public.client_approval_decisions set comment = 'alterado' where decision = 'approved'$$,
  '55000', null,
  'decision records cannot be changed even by a privileged database actor'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000007', true);
select set_config('request.headers', '{"x-doti-agency-id":"28000000-0000-4000-8000-000000000001"}', true);
select is(public.load_client_approval_queue() ->> 'role', 'admin', 'DOTI administrative support assumes the agency admin role');
select lives_ok(
  $$select public.submit_client_approval(
    '78000000-0000-4000-8000-000000000005',
    '88000000-0000-4000-8000-000000000502',
    'approved',
    'Validado em suporte'
  )$$,
  'DOTI administrative support can decide agency approvals'
);
select is((select status from public.deliverables where id = '78000000-0000-4000-8000-000000000005'), 'done', 'support approval completes the final deliverable');
select is(
  (select decided_by_role from public.client_approval_decisions where deliverable_id = '78000000-0000-4000-8000-000000000005'),
  'admin',
  'support decisions preserve the effective author role in history'
);

reset role;
select lives_ok(
  $$select public.platform_transfer_agency_owner(
    '28000000-0000-4000-8000-000000000001',
    '18000000-0000-4000-8000-000000000006',
    '18000000-0000-4000-8000-000000000007'
  )$$,
  'ownership transfer safely converts a customer profile'
);
select is(
  (select client_id from public.profiles where id = '18000000-0000-4000-8000-000000000006'),
  null::uuid,
  'a profile promoted out of the customer role no longer keeps a client assignment'
);

select * from finish();
rollback;
