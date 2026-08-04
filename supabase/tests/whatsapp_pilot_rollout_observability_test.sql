begin;

create extension if not exists pgtap;
select plan(45);

insert into auth.users (id, email)
values
  ('14000000-0000-4000-8000-000000000001', 'pilot-owner-a@doti.test'),
  ('14000000-0000-4000-8000-000000000002', 'pilot-member-a@doti.test'),
  ('14000000-0000-4000-8000-000000000003', 'pilot-viewer-a@doti.test'),
  ('14000000-0000-4000-8000-000000000004', 'pilot-owner-b@doti.test');

insert into public.agencies (id, name, owner_id)
values
  ('24000000-0000-4000-8000-000000000001', 'Piloto Agência A', '14000000-0000-4000-8000-000000000001'),
  ('24000000-0000-4000-8000-000000000002', 'Bloqueada Agência B', '14000000-0000-4000-8000-000000000004');

update public.profiles profile
set agency_id = fixture.agency_id, full_name = fixture.full_name,
    agency_name = fixture.agency_name, role = fixture.role, is_active = true
from (values
  ('14000000-0000-4000-8000-000000000001'::uuid, '24000000-0000-4000-8000-000000000001'::uuid, 'Pilot Owner A', 'Piloto Agência A', 'owner'),
  ('14000000-0000-4000-8000-000000000002'::uuid, '24000000-0000-4000-8000-000000000001'::uuid, 'Pilot Member A', 'Piloto Agência A', 'member'),
  ('14000000-0000-4000-8000-000000000003'::uuid, '24000000-0000-4000-8000-000000000001'::uuid, 'Pilot Viewer A', 'Piloto Agência A', 'viewer'),
  ('14000000-0000-4000-8000-000000000004'::uuid, '24000000-0000-4000-8000-000000000002'::uuid, 'Pilot Owner B', 'Bloqueada Agência B', 'owner')
) fixture(id, agency_id, full_name, agency_name, role)
where profile.id = fixture.id;

insert into public.meta_connections (
  id, agency_id, name, whatsapp_business_account_id, phone_number_id, created_by, updated_by
) values
  ('34000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', 'Conta Piloto', 'waba-pilot-a', 'phone-pilot-a', '14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001'),
  ('34000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000002', 'Conta Bloqueada', 'waba-blocked-b', 'phone-blocked-b', '14000000-0000-4000-8000-000000000004', '14000000-0000-4000-8000-000000000004');

insert into private.meta_connection_credentials (
  connection_id, agency_id, token_ciphertext, token_iv, key_version, rotated_by
) values (
  '34000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001',
  repeat('s', 32), repeat('i', 16), 1, '14000000-0000-4000-8000-000000000001'
);

insert into public.meta_templates (
  id, agency_id, connection_id, meta_template_id, name, language,
  category, status, components, parameters, created_by, updated_by
) values
  ('44000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001',
   '34000000-0000-4000-8000-000000000001', 'pilot-template-a', 'lembrete_piloto', 'pt_BR',
   'utility', 'approved', '[{"type":"BODY","text":"Olá {{nome}}, código {{codigo}}"}]',
   '[{"component":"body","name":"nome","kind":"text"},{"component":"body","name":"codigo","kind":"text"}]',
   '14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001'),
  ('44000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000002',
   '34000000-0000-4000-8000-000000000002', 'blocked-template-b', 'aviso_bloqueado', 'pt_BR',
   'utility', 'approved', '[]', '[]',
   '14000000-0000-4000-8000-000000000004', '14000000-0000-4000-8000-000000000004');

select has_index(
  'public', 'meta_connections', 'meta_connections_one_live_per_agency_idx',
  'database enforces one usable Meta connection per agency'
);
select throws_ok(
  $$insert into public.meta_connections (
    agency_id, name, whatsapp_business_account_id, phone_number_id, status, created_by, updated_by
  ) values (
    '24000000-0000-4000-8000-000000000001', 'Segunda conta ativa', 'waba-pilot-extra',
    'phone-pilot-extra', 'active', '14000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001'
  )$$,
  '23505', null, 'a second usable connection in the same agency is rejected'
);
select lives_ok(
  $$insert into public.meta_connections (
    agency_id, name, whatsapp_business_account_id, phone_number_id, status, created_by, updated_by
  ) values (
    '24000000-0000-4000-8000-000000000001', 'Conta histórica', 'waba-pilot-history',
    'phone-pilot-history', 'disconnected', '14000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001'
  )$$,
  'a disconnected credential can remain as history without becoming usable'
);

select has_table('public', 'meta_whatsapp_rollouts', 'rollout state has a public non-sensitive interface');
select has_table('private', 'meta_pilot_recipient_allowlist', 'pilot allowlist is private');
select has_table('private', 'meta_whatsapp_technical_logs', 'technical logs are private');
select ok(
  not has_function_privilege('authenticated', 'public.configure_meta_whatsapp_rollout(uuid,text,boolean,text[])', 'EXECUTE'),
  'browser users cannot configure a rollout'
);
select ok(
  not has_table_privilege('authenticated', 'private.meta_pilot_recipient_allowlist', 'SELECT'),
  'browser users cannot read authorized recipient hashes'
);
select ok(
  not has_table_privilege('authenticated', 'private.meta_whatsapp_technical_logs', 'SELECT'),
  'browser users cannot read technical logs'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
    'Antes da liberação', '[{"phone":"+5511999999999","variables":{"nome":"Ana","codigo":"1"}}]'
  )$$,
  '42501', null, 'an agency without rollout cannot create a campaign'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
select lives_ok(
  $$select public.configure_meta_whatsapp_rollout(
    '24000000-0000-4000-8000-000000000001', 'pilot', true,
    array[
      encode(extensions.digest('+5511999999999', 'sha256'), 'hex'),
      encode(extensions.digest('+5511888888888', 'sha256'), 'hex')
    ]
  )$$,
  'operations enables exactly one pilot agency with hashed internal recipients'
);
select throws_ok(
  $$select public.configure_meta_whatsapp_rollout(
    '24000000-0000-4000-8000-000000000001', 'pilot', true, array['+5511999999999']
  )$$,
  '22023', null, 'rollout rejects full phone numbers instead of storing them'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000001', true);
select is(
  (select release_stage from public.meta_whatsapp_rollouts), 'pilot',
  'pilot agency can read only its non-sensitive rollout state'
);
select throws_ok(
  $$insert into public.meta_campaigns (
    agency_id, connection_id, template_id, name, status, scheduled_at
  ) values (
    '24000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Agendamento proibido', 'scheduled', now() + interval '1 day'
  )$$,
  '23514', null, 'direct database access cannot schedule a V1 campaign'
);
select lives_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
    'Ciclo piloto completo',
    '[{"phone":"+5511999999999","variables":{"nome":"João & Cia. — ação 🎯","codigo":"A;\"B\"\nC"}}]'
  )$$,
  'pilot owner creates a campaign for an authorized internal number with special characters'
);
select is(
  (select template_variables ->> 'nome' from public.meta_campaign_recipients where campaign_id = (
    select id from public.meta_campaigns where name = 'Ciclo piloto completo'
  )),
  'João & Cia. — ação 🎯',
  'unicode and special characters remain intact in template variables'
);
select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
    'Número externo', '[{"phone":"+5511777777777","variables":{"nome":"Externo","codigo":"2"}}]'
  )$$,
  '42501', null, 'pilot campaign creation rejects a number outside the private allowlist'
);
select lives_ok(
  $$select public.queue_meta_campaign((select id from public.meta_campaigns where name = 'Ciclo piloto completo'))$$,
  'authorized pilot campaign can be queued'
);

select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
    'Member bloqueado', '[{"phone":"+5511999999999","variables":{"nome":"Ana","codigo":"3"}}]'
  )$$,
  '42501', null, 'member cannot create a campaign during pilot'
);
select throws_ok(
  $$select public.queue_meta_campaign((select id from public.meta_campaigns where name = 'Ciclo piloto completo'))$$,
  '42501', null, 'member cannot dispatch a pilot campaign'
);
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
    'Viewer bloqueado', '[{"phone":"+5511999999999","variables":{"nome":"Ana","codigo":"4"}}]'
  )$$,
  '42501', null, 'viewer cannot create a campaign during pilot'
);

select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.meta_whatsapp_rollouts), 0, 'another agency cannot see pilot rollout state');
select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002',
    'Agência não liberada', '[{"phone":"+5511666666666","variables":{}}]'
  )$$,
  '42501', null, 'another agency remains blocked until explicitly released'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
create temp table pilot_claim as
select * from public.claim_meta_campaign_batch(
  (select id from public.meta_campaigns where name = 'Ciclo piloto completo'), 1
);
select is((select count(*)::integer from pilot_claim), 1, 'worker claims the authorized pilot recipient once');
select lives_ok(format(
  $$select public.record_meta_send_result(%L, %L, true, false, 200, '', '', 'wamid.pilot.1', '{"latencyMs":125}')$$,
  (select recipient_id from pilot_claim), (select processing_token from pilot_claim)
), 'pilot send response is recorded without a duplicate');
select lives_ok(
  $$select public.finalize_meta_campaign((select id from public.meta_campaigns where name = 'Ciclo piloto completo'))$$,
  'worker finalizes the pilot campaign'
);
select is((select status from public.meta_campaigns where name = 'Ciclo piloto completo'), 'completed', 'pilot campaign completes after the accepted send');
select lives_ok(
  $$select public.record_meta_delivery_event(
    'phone-pilot-a', 'wamid.pilot.1', 'delivered', now(), '', '', 'pilot-delivered-1', '{}'
  )$$,
  'signed delivery webhook advances the pilot recipient'
);
select lives_ok(
  $$select public.record_meta_delivery_event(
    'phone-pilot-a', 'wamid.pilot.1', 'read', now(), '', '', 'pilot-read-1', '{}'
  )$$,
  'signed read webhook completes the pilot lifecycle'
);
select is(
  (select status from public.meta_campaign_recipients where meta_message_id = 'wamid.pilot.1'),
  'read', 'pilot recipient reaches read status'
);
select is(
  (select count(*)::integer from private.meta_whatsapp_technical_logs where agency_id = '24000000-0000-4000-8000-000000000001'),
  3, 'send, delivery and read produce technical logs'
);
select ok(
  not exists (
    select 1 from private.meta_whatsapp_technical_logs log
    where to_jsonb(log)::text ~ '(5511999999999|João|wamid\.pilot|ssssssss|iiiiiiii)'
  ),
  'technical logs contain no full phone, template variables, wamid or credential material'
);
select is(
  (public.get_meta_whatsapp_operational_metrics('24000000-0000-4000-8000-000000000001', now() - interval '1 hour') ->> 'sendAttempts')::integer,
  1, 'monitoring reports send attempts'
);
select is(
  (public.get_meta_whatsapp_operational_metrics('24000000-0000-4000-8000-000000000001', now() - interval '1 hour') ->> 'webhookEvents')::integer,
  2, 'monitoring reports webhook volume'
);
select is(
  (public.get_meta_whatsapp_operational_metrics('24000000-0000-4000-8000-000000000001', now() - interval '1 hour') ->> 'counterDivergences')::integer,
  0, 'monitoring finds no counter divergence after the full lifecycle'
);

select lives_ok(
  $$select public.configure_meta_whatsapp_rollout(
    '24000000-0000-4000-8000-000000000001', 'pilot', true,
    (select array_agg(encode(extensions.digest('+551190' || lpad(number::text, 7, '0'), 'sha256'), 'hex'))
     from generate_series(1, 100) number)
  )$$,
  'pilot allowlist accepts exactly 100 internal recipients for load validation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
    'Carga de 100 destinatários',
    (select jsonb_agg(jsonb_build_object(
      'phone', '+551190' || lpad(number::text, 7, '0'),
      'variables', jsonb_build_object('nome', 'Contato ' || number, 'codigo', 'L-' || number)
    )) from generate_series(1, 100) number)
  )$$,
  'database validates a campaign with exactly 100 authorized recipients'
);
select is(
  (select count(*)::integer from public.meta_campaign_recipients where campaign_id = (
    select id from public.meta_campaigns where name = 'Carga de 100 destinatários'
  )),
  100, 'load campaign persists all 100 recipients without loss'
);
select lives_ok(
  $$select public.queue_meta_campaign((select id from public.meta_campaigns where name = 'Carga de 100 destinatários'))$$,
  'load campaign with 100 recipients reaches the worker queue'
);
select throws_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
    'Carga inválida de 101',
    (select jsonb_agg(jsonb_build_object(
      'phone', '+551191' || lpad(number::text, 7, '0'),
      'variables', jsonb_build_object('nome', 'Contato ' || number, 'codigo', 'X-' || number)
    )) from generate_series(1, 101) number)
  )$$,
  '22023', null, 'campaigns with more than 100 rows remain blocked'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
select lives_ok(
  $$select public.configure_meta_whatsapp_rollout(
    '24000000-0000-4000-8000-000000000001', 'general', true, array[]::text[]
  )$$,
  'operations can release the pilot agency generally after monitoring'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.save_meta_campaign_draft(
    null, '34000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
    'Após liberação geral', '[{"phone":"+5511777777777","variables":{"nome":"Cliente","codigo":"G-1"}}]'
  )$$,
  'general release no longer requires the pilot allowlist'
);
select throws_ok(
  $$update public.meta_campaigns set status = 'cancelled' where name = 'Após liberação geral'$$,
  '23514', null, 'a V1 draft cannot be changed to cancelled through direct table access'
);

reset role;
set local role service_role;
select is(
  (select count(*)::integer from private.meta_pilot_recipient_allowlist where agency_id = '24000000-0000-4000-8000-000000000001'),
  0, 'general release clears the temporary pilot allowlist'
);
select is(
  (public.get_meta_whatsapp_operational_metrics('24000000-0000-4000-8000-000000000002', now() - interval '1 hour') ->> 'sendAttempts')::integer,
  0, 'operational metrics remain isolated when filtered by agency'
);

select * from finish();
rollback;
