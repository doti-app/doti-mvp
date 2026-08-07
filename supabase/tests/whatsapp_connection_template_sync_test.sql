begin;

create extension if not exists pgtap;
select plan(20);

insert into auth.users (id, email)
values
  ('12000000-0000-4000-8000-000000000001', 'whatsapp-owner-a@doti.test'),
  ('12000000-0000-4000-8000-000000000002', 'whatsapp-owner-b@doti.test');

insert into public.agencies (id, name, owner_id)
values
  ('22000000-0000-4000-8000-000000000001', 'WhatsApp Agência A', '12000000-0000-4000-8000-000000000001'),
  ('22000000-0000-4000-8000-000000000002', 'WhatsApp Agência B', '12000000-0000-4000-8000-000000000002');

update public.profiles p
set agency_id = fixture.agency_id,
    full_name = fixture.full_name,
    agency_name = fixture.agency_name,
    role = 'owner',
    is_active = true
from (
  values
    ('12000000-0000-4000-8000-000000000001'::uuid, '22000000-0000-4000-8000-000000000001'::uuid, 'WhatsApp Owner A', 'WhatsApp Agência A'),
    ('12000000-0000-4000-8000-000000000002'::uuid, '22000000-0000-4000-8000-000000000002'::uuid, 'WhatsApp Owner B', 'WhatsApp Agência B')
) as fixture(id, agency_id, full_name, agency_name)
where p.id = fixture.id;

select public.configure_meta_whatsapp_rollout(
  '22000000-0000-4000-8000-000000000001', 'general', true, array[]::text[]
);

delete from public.agencies
where id not in (
  '22000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002'
);

select has_column(
  'public', 'meta_templates', 'parameters',
  'templates store their extracted parameters'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_meta_connection_secret(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'browser users cannot retrieve encrypted credentials'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.store_validated_meta_connection(uuid,uuid,text,text,text,text,text,text,smallint,uuid,jsonb)',
    'EXECUTE'
  ),
  'the Edge Function service role can store a validated connection atomically'
);

select lives_ok(
  $$select public.store_validated_meta_connection(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'Conta Meta Agência A',
    '123456789012345',
    '987654321098765',
    '+55 11 99999-9999',
    repeat('A', 32),
    repeat('B', 16),
    1::smallint,
    '12000000-0000-4000-8000-000000000001',
    '[{
      "id":"template-approved-a",
      "name":"boas_vindas",
      "language":"pt_BR",
      "category":"marketing",
      "status":"approved",
      "components":[{"type":"BODY","text":"Olá {{1}}"}],
      "parameters":[{"component":"body","name":"1","kind":"text"}],
      "qualityScore":"GREEN"
    }]'::jsonb
  )$$,
  'validated connection and approved templates are stored in one operation'
);

select is(
  (select status from public.meta_connections where id = '32000000-0000-4000-8000-000000000001'),
  'active',
  'a validated connection is active'
);

select ok(
  (select last_verified_at is not null and last_synced_at is not null
   from public.meta_connections where id = '32000000-0000-4000-8000-000000000001'),
  'validation and synchronization timestamps are recorded'
);

select is(
  (select status from public.meta_templates where meta_template_id = 'template-approved-a'),
  'approved',
  'approved template is available after synchronization'
);

select is(
  (select parameters -> 0 ->> 'name' from public.meta_templates where meta_template_id = 'template-approved-a'),
  '1',
  'template parameters are persisted'
);

select throws_ok(
  $$select public.sync_approved_meta_templates(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '[{
      "id":"template-rejected-a",
      "name":"reprovado",
      "language":"pt_BR",
      "category":"marketing",
      "status":"rejected",
      "components":[],
      "parameters":[]
    }]'::jsonb
  )$$,
  '22023',
  'Template aprovado inválido.',
  'non-approved template payloads are rejected'
);

select lives_ok(
  $$select public.sync_approved_meta_templates(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '[]'::jsonb
  )$$,
  'an empty approved list synchronizes successfully'
);

select is(
  (select status from public.meta_templates where meta_template_id = 'template-approved-a'),
  'disabled',
  'templates absent from the approved Meta response become unavailable'
);

select lives_ok(
  $$select public.mark_meta_connection_check(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    false
  )$$,
  'an invalid or expired Meta credential marks the connection for attention'
);
select is(
  (select status from public.meta_connections where id = '32000000-0000-4000-8000-000000000001'),
  'attention',
  'failed connection validation is visible without exposing the credential'
);
select lives_ok(
  $$select public.store_validated_meta_connection(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'Conta Meta Agência A',
    '123456789012345',
    '987654321098765',
    '+55 11 99999-9999',
    repeat('C', 32),
    repeat('D', 16),
    1::smallint,
    '12000000-0000-4000-8000-000000000001',
    '[]'::jsonb
  )$$,
  'a newly validated token atomically replaces an invalid or expired credential'
);
select is(
  (select token_ciphertext from private.meta_connection_credentials
   where connection_id = '32000000-0000-4000-8000-000000000001'),
  repeat('C', 32),
  'credential replacement stores only the new ciphertext in the private schema'
);
select is(
  (select status from public.meta_connections where id = '32000000-0000-4000-8000-000000000001'),
  'active',
  'successful replacement restores the connection to active'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*)::integer from public.meta_templates where status = 'approved'),
  0,
  'the agency sees no disabled template as available for a new campaign'
);

select throws_ok(
  $$insert into public.meta_campaigns (
    agency_id, connection_id, template_id, name
  ) select
    '22000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001',
    id,
    'Campanha com template desativado'
  from public.meta_templates
  where meta_template_id = 'template-approved-a'$$,
  '23514',
  'O template não está aprovado e disponível para esta conexão.',
  'a disabled template cannot be used by a new campaign'
);

select throws_ok(
  $$select public.get_meta_connection_secret(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  null,
  'authenticated browser role cannot execute the credential RPC'
);

reset role;

select throws_ok(
  $$select public.get_meta_connection_secret(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'Operação administrativa não autorizada.',
  'an owner from another agency cannot retrieve the connection secret'
);

select * from finish();
rollback;
