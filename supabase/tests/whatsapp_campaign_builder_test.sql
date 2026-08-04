begin;

create extension if not exists pgtap;
select plan(12);

insert into auth.users (id, email)
values
  ('12000000-0000-4000-8000-000000000001', 'campaign-owner-a@doti.test'),
  ('12000000-0000-4000-8000-000000000002', 'campaign-member-a@doti.test'),
  ('12000000-0000-4000-8000-000000000003', 'campaign-owner-b@doti.test');

insert into public.agencies (id, name, owner_id)
values
  ('22000000-0000-4000-8000-000000000001', 'Campaign Agência A', '12000000-0000-4000-8000-000000000001'),
  ('22000000-0000-4000-8000-000000000002', 'Campaign Agência B', '12000000-0000-4000-8000-000000000003');

update public.profiles profile
set agency_id = fixture.agency_id,
    full_name = fixture.full_name,
    agency_name = fixture.agency_name,
    role = fixture.role,
    is_active = true
from (
  values
    ('12000000-0000-4000-8000-000000000001'::uuid, '22000000-0000-4000-8000-000000000001'::uuid, 'Campaign Owner A', 'Campaign Agência A', 'owner'),
    ('12000000-0000-4000-8000-000000000002'::uuid, '22000000-0000-4000-8000-000000000001'::uuid, 'Campaign Member A', 'Campaign Agência A', 'member'),
    ('12000000-0000-4000-8000-000000000003'::uuid, '22000000-0000-4000-8000-000000000002'::uuid, 'Campaign Owner B', 'Campaign Agência B', 'owner')
) as fixture(id, agency_id, full_name, agency_name, role)
where profile.id = fixture.id;

select public.configure_meta_whatsapp_rollout(
  '22000000-0000-4000-8000-000000000001', 'general', true, array[]::text[]
);

insert into public.meta_connections (
  id, agency_id, name, whatsapp_business_account_id, phone_number_id, created_by, updated_by
)
values
  ('32000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', 'Conta A', 'waba-campaign-a', 'phone-campaign-a', '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001'),
  ('32000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002', 'Conta B', 'waba-campaign-b', 'phone-campaign-b', '12000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000003');

insert into public.meta_templates (
  id, agency_id, connection_id, meta_template_id, name, language,
  category, status, components, parameters, created_by, updated_by
)
values
  (
    '42000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001', 'campaign-template-a', 'lembrete', 'pt_BR',
    'utility', 'approved', '[{"type":"BODY","text":"Olá {{1}}"}]',
    '[{"component":"body","name":"1","kind":"text"}]',
    '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001'
  ),
  (
    '42000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002',
    '32000000-0000-4000-8000-000000000002', 'campaign-template-b', 'aviso', 'pt_BR',
    'utility', 'approved', '[{"type":"BODY","text":"Aviso"}]', '[]',
    '12000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000003'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.save_meta_campaign_draft(
    null,
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    'Lembrete válido',
    '[{"phone":"+5511999999999","variables":{"1":"Ana"}},{"phone":"+14155552671","variables":{"1":"John"}}]'
  )$$,
  'owner can atomically save a valid draft'
);

select is((select count(*)::integer from public.meta_campaigns), 1, 'only the agency campaign is visible');
select is((select count(*)::integer from public.meta_campaign_recipients), 2, 'valid recipients are stored');

select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '32000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
    'Duplicada', '[{"phone":"+5511999999999","variables":{"1":"Ana"}},{"phone":"+5511999999999","variables":{"1":"Bia"}}]'
  )$$,
  '22023', null, 'duplicate phones are rejected by the database contract'
);

select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '32000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
    'Incompleta', '[{"phone":"+5511999999999","variables":{}}]'
  )$$,
  '22023', null, 'missing required variables block the draft'
);

select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '32000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
    'Grande demais', (
      select jsonb_agg(jsonb_build_object(
        'phone', '+5511' || lpad(value::text, 9, '0'),
        'variables', jsonb_build_object('1', 'Contato ' || value)
      )) from generate_series(1, 101) value
    )
  )$$,
  '22023', null, 'campaigns above 100 contacts are blocked'
);

select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '32000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
    'Lista nula', null
  )$$,
  '22023', null, 'null recipient payloads are rejected'
);

select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '32000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002',
    'Outra agência', '[{"phone":"+5511999999999","variables":{}}]'
  )$$,
  '23514', null, 'cross-agency templates and connections cannot be used'
);

select lives_ok(
  $$select public.queue_meta_campaign((select id from public.meta_campaigns where name = 'Lembrete válido'))$$,
  'final confirmation queues a fully validated draft'
);

select is(
  (select status from public.meta_campaigns where name = 'Lembrete válido'),
  'queued',
  'confirmed campaign becomes queued'
);

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '32000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
    'Sem permissão', '[{"phone":"+5511999999999","variables":{"1":"Ana"}}]'
  )$$,
  '42501', null, 'members cannot create campaigns'
);

select throws_ok(
  $$select public.queue_meta_campaign((select id from public.meta_campaigns where name = 'Lembrete válido'))$$,
  '42501', null, 'members cannot confirm campaign dispatches'
);

select * from finish();
rollback;
