begin;

create extension if not exists pgtap;
select plan(38);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'owner-a@doti.test'),
  ('10000000-0000-4000-8000-000000000002', 'admin-a@doti.test'),
  ('10000000-0000-4000-8000-000000000003', 'member-a@doti.test'),
  ('10000000-0000-4000-8000-000000000004', 'viewer-a@doti.test'),
  ('10000000-0000-4000-8000-000000000005', 'owner-b@doti.test'),
  ('10000000-0000-4000-8000-000000000006', 'inactive-a@doti.test'),
  ('10000000-0000-4000-8000-000000000007', 'no-profile@doti.test');

insert into public.agencies (id, name, owner_id)
values
  ('20000000-0000-4000-8000-000000000001', 'Agência A', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Agência B', '10000000-0000-4000-8000-000000000005');

update public.profiles p
set
  agency_id = fixture.agency_id,
  full_name = fixture.full_name,
  agency_name = fixture.agency_name,
  role = fixture.role,
  is_active = fixture.is_active
from (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'Owner A', 'Agência A', 'owner', true),
    ('10000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'Admin A', 'Agência A', 'admin', true),
    ('10000000-0000-4000-8000-000000000003'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'Member A', 'Agência A', 'member', true),
    ('10000000-0000-4000-8000-000000000004'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'Viewer A', 'Agência A', 'viewer', true),
    ('10000000-0000-4000-8000-000000000005'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 'Owner B', 'Agência B', 'owner', true),
    ('10000000-0000-4000-8000-000000000006'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'Inactive A', 'Agência A', 'member', false)
) as fixture(id, agency_id, full_name, agency_name, role, is_active)
where p.id = fixture.id;

delete from public.profiles where id = '10000000-0000-4000-8000-000000000007';
delete from public.agencies
where id not in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
);

insert into public.clients (id, agency_id, name, color)
values ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Cliente B', '#ffd400');

insert into storage.objects (id, bucket_id, name, owner)
values (
  '90000000-0000-4000-8000-000000000002',
  'doti-files',
  '20000000-0000-4000-8000-000000000002/files/arquivo-b.pdf',
  '10000000-0000-4000-8000-000000000005'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$insert into public.agency_groups (id, agency_id, name, initials)
    values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Atendimento', 'AT')$$,
  'owner can create agency configuration'
);

select is(
  (select count(*)::integer from public.clients where agency_id = '20000000-0000-4000-8000-000000000002'),
  0,
  'owner cannot read another agency'
);

select is_empty(
  $$update public.clients set name = 'Ataque'
    where id = '30000000-0000-4000-8000-000000000002'
    returning id$$,
  'owner cannot update another agency'
);

select is_empty(
  $$delete from public.clients
    where id = '30000000-0000-4000-8000-000000000002'
    returning id$$,
  'owner cannot delete another agency'
);

select throws_ok(
  $$insert into public.projects (id, agency_id, client_id, name, due_date)
    values (
      '50000000-0000-4000-8000-000000000099',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      'Projeto cruzado',
      current_date
    )$$,
  '23503',
  null,
  'composite foreign keys reject cross-agency relationships'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$insert into public.agency_groups (id, agency_id, name, initials)
    values ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Design', 'DE')$$,
  'admin can create agency configuration'
);

select lives_ok(
  $$update public.agency_groups set initials = 'DS'
    where id = '40000000-0000-4000-8000-000000000002'$$,
  'admin can update agency configuration'
);

select lives_ok(
  $$delete from public.agency_groups
    where id = '40000000-0000-4000-8000-000000000002'$$,
  'admin can delete agency configuration'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$insert into public.agency_groups (id, agency_id, name, initials)
    values ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Mídia', 'MI')$$,
  '42501',
  null,
  'member cannot create agency configuration'
);

select lives_ok(
  $$insert into public.clients (id, agency_id, name, color)
    values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Cliente A', '#ffd400')$$,
  'member can create clients'
);

select lives_ok(
  $$update public.clients set color = '#111111'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  'member can update clients'
);

select is_empty(
  $$delete from public.clients
    where id = '30000000-0000-4000-8000-000000000001'
    returning id$$,
  'member cannot delete structural records'
);

select lives_ok(
  $$insert into public.projects (id, agency_id, client_id, name, due_date)
    values (
      '50000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Projeto A',
      current_date
    )$$,
  'member can create projects'
);

select lives_ok(
  $$insert into public.deliverables (
      id, agency_id, project_id, name, category
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      'Entrega A',
      'Design'
    )$$,
  'member can create deliverables'
);

select lives_ok(
  $$insert into public.deliverable_steps (
      id, agency_id, deliverable_id, group_id, name, position
    ) values (
      '70000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'Produção',
      0
    )$$,
  'member can create deliverable steps'
);

select lives_ok(
  $$insert into public.step_tasks (
      id, agency_id, deliverable_step_id, title, position
    ) values (
      '80000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      'Revisar',
      0
    )$$,
  'member can create auxiliary tasks'
);

select lives_ok(
  $$delete from public.step_tasks
    where id = '80000000-0000-4000-8000-000000000001'$$,
  'member can delete auxiliary tasks'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

select is(
  (select count(*)::integer from public.clients),
  1,
  'viewer reads only its own agency'
);

select throws_ok(
  $$insert into public.clients (id, agency_id, name, color)
    values ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Bloqueado', '#ffd400')$$,
  '42501',
  null,
  'viewer cannot insert operational records'
);

select is_empty(
  $$update public.clients set name = 'Bloqueado'
    where id = '30000000-0000-4000-8000-000000000001'
    returning id$$,
  'viewer cannot update operational records'
);

select is_empty(
  $$delete from public.clients
    where id = '30000000-0000-4000-8000-000000000001'
    returning id$$,
  'viewer cannot delete operational records'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select is((select count(*)::integer from public.clients), 0, 'inactive user cannot read operation data');

select throws_ok(
  $$insert into public.clients (id, agency_id, name, color)
    values ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', 'Bloqueado', '#ffd400')$$,
  '42501',
  null,
  'inactive user cannot write operation data'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);

select is((select count(*)::integer from public.clients), 0, 'user without profile cannot read operation data');

select throws_ok(
  $$insert into public.clients (id, agency_id, name, color)
    values ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', 'Bloqueado', '#ffd400')$$,
  '42501',
  null,
  'user without profile cannot write operation data'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.save_agency_state(
    '{"version":4,"groups":[],"workflows":[],"clients":[],"projects":[],"deliverables":[],"activity":[]}'::jsonb,
    0
  )$$,
  'owner can initialize the atomic agency state'
);

select throws_ok(
  $$select public.save_agency_state(
    '{"version":4,"groups":[],"workflows":[],"clients":[],"projects":[],"deliverables":[],"activity":[]}'::jsonb,
    0
  )$$,
  '40001',
  null,
  'stale agency revision is rejected'
);

select lives_ok(
  $$select public.save_agency_state(
    '{
      "version": 4,
      "groups": [
        {"id":"41000000-0000-4000-8000-000000000001","name":"Atendimento","initials":"AT"}
      ],
      "workflows": [
        {
          "id":"42000000-0000-4000-8000-000000000001",
          "name":"Fluxo editável",
          "category":"Conteúdo",
          "steps":[
            ["Briefing","41000000-0000-4000-8000-000000000001","43000000-0000-4000-8000-000000000001"],
            ["Produção","41000000-0000-4000-8000-000000000001","43000000-0000-4000-8000-000000000002"]
          ]
        }
      ],
      "clients":[],"projects":[],"deliverables":[],"activity":[]
    }'::jsonb,
    1
  )$$,
  'owner can create a workflow before editing its steps'
);

select lives_ok(
  $$select public.save_agency_state(
    '{
      "version": 4,
      "groups": [
        {"id":"41000000-0000-4000-8000-000000000001","name":"Atendimento","initials":"AT"}
      ],
      "workflows": [
        {
          "id":"42000000-0000-4000-8000-000000000001",
          "name":"Fluxo editável",
          "category":"Conteúdo",
          "steps":[
            ["Produção","41000000-0000-4000-8000-000000000001","43000000-0000-4000-8000-000000000002"],
            ["Revisão","41000000-0000-4000-8000-000000000001","43000000-0000-4000-8000-000000000003"],
            ["Briefing","41000000-0000-4000-8000-000000000001","43000000-0000-4000-8000-000000000001"]
          ]
        }
      ],
      "clients":[],"projects":[],"deliverables":[],"activity":[]
    }'::jsonb,
    2
  )$$,
  'owner can reorder existing workflow steps and add a new one atomically'
);

select results_eq(
  $$select id::text
    from public.workflow_steps
    where workflow_id = '42000000-0000-4000-8000-000000000001'
    order by position$$,
  $$values
    ('43000000-0000-4000-8000-000000000002'),
    ('43000000-0000-4000-8000-000000000003'),
    ('43000000-0000-4000-8000-000000000001')$$,
  'workflow steps persist in the edited order'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select lives_ok(
  $$insert into storage.objects (id, bucket_id, name, owner)
    values (
      '90000000-0000-4000-8000-000000000001',
      'doti-files',
      '20000000-0000-4000-8000-000000000001/files/arquivo-a.pdf',
      '10000000-0000-4000-8000-000000000003'
    )$$,
  'member can upload inside its agency folder'
);

select throws_ok(
  $$insert into storage.objects (id, bucket_id, name, owner)
    values (
      '90000000-0000-4000-8000-000000000003',
      'doti-files',
      '20000000-0000-4000-8000-000000000002/files/ataque.pdf',
      '10000000-0000-4000-8000-000000000003'
    )$$,
  '42501',
  null,
  'member cannot upload into another agency folder'
);

select lives_ok(
  $$update storage.objects
    set metadata = '{"updated":true}'::jsonb
    where id = '90000000-0000-4000-8000-000000000001'$$,
  'member can replace its agency file'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

select is(
  (select count(*)::integer from storage.objects where id = '90000000-0000-4000-8000-000000000001'),
  1,
  'viewer can download its agency file'
);

select throws_ok(
  $$insert into storage.objects (id, bucket_id, name, owner)
    values (
      '90000000-0000-4000-8000-000000000004',
      'doti-files',
      '20000000-0000-4000-8000-000000000001/files/viewer.pdf',
      '10000000-0000-4000-8000-000000000004'
    )$$,
  '42501',
  null,
  'viewer cannot upload files'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*)::integer from storage.objects where id = '90000000-0000-4000-8000-000000000002'),
  0,
  'owner cannot download another agency file'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$delete from storage.objects
    where id = '90000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'storage protects objects from direct SQL deletion'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select is(
  (select count(*)::integer from storage.objects),
  0,
  'inactive user cannot read storage objects'
);

select * from finish();
rollback;
