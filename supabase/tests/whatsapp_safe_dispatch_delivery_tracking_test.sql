begin;

create extension if not exists pgtap;
select plan(31);

insert into auth.users (id, email)
values
  ('13000000-0000-4000-8000-000000000001', 'dispatch-owner-a@doti.test'),
  ('13000000-0000-4000-8000-000000000002', 'dispatch-owner-b@doti.test');

insert into public.agencies (id, name, owner_id)
values
  ('23000000-0000-4000-8000-000000000001', 'Dispatch Agência A', '13000000-0000-4000-8000-000000000001'),
  ('23000000-0000-4000-8000-000000000002', 'Dispatch Agência B', '13000000-0000-4000-8000-000000000002');

update public.profiles profile
set agency_id = fixture.agency_id, full_name = fixture.full_name,
    agency_name = fixture.agency_name, role = 'owner', is_active = true
from (values
  ('13000000-0000-4000-8000-000000000001'::uuid, '23000000-0000-4000-8000-000000000001'::uuid, 'Dispatch Owner A', 'Dispatch Agência A'),
  ('13000000-0000-4000-8000-000000000002'::uuid, '23000000-0000-4000-8000-000000000002'::uuid, 'Dispatch Owner B', 'Dispatch Agência B')
) fixture(id, agency_id, full_name, agency_name)
where profile.id = fixture.id;

select public.configure_meta_whatsapp_rollout(
  '23000000-0000-4000-8000-000000000001', 'general', true, array[]::text[]
);

insert into public.meta_connections (
  id, agency_id, name, whatsapp_business_account_id, phone_number_id, created_by, updated_by
) values
  ('33000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', 'Conta Dispatch A', 'waba-dispatch-a', 'phone-dispatch-a', '13000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000002', 'Conta Dispatch B', 'waba-dispatch-b', 'phone-dispatch-b', '13000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000002');

insert into private.meta_connection_credentials (
  connection_id, agency_id, token_ciphertext, token_iv, key_version, rotated_by
) values (
  '33000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001',
  repeat('a', 32), repeat('b', 16), 1, '13000000-0000-4000-8000-000000000001'
);

insert into public.meta_templates (
  id, agency_id, connection_id, meta_template_id, name, language,
  category, status, components, parameters, created_by, updated_by
) values (
  '43000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000001', 'dispatch-template-a', 'lembrete_dispatch', 'pt_BR',
  'utility', 'approved', '[{"type":"BODY","text":"Olá {{1}}"}]',
  '[{"component":"body","name":"1","kind":"text"}]',
  '13000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.save_meta_campaign_draft(
    null, '33000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001',
    'Disparo rastreável',
    '[{"phone":"+5511999999999","variables":{"1":"Ana"}},{"phone":"+5511888888888","variables":{"1":"Bia"}}]'
  )$$,
  'campaign and recipients start as a server-validated draft'
);
select is((select count(*)::integer from public.meta_campaign_recipients where status = 'pending'), 2, 'recipients start pending');
select is((select total_count from public.meta_campaigns where name = 'Disparo rastreável'), 2, 'progress trigger stores total');
select is((select pending_count from public.meta_campaigns where name = 'Disparo rastreável'), 2, 'initial total is entirely pending');
select lives_ok(
  $$select public.queue_meta_campaign((select id from public.meta_campaigns where name = 'Disparo rastreável'))$$,
  'manager queues campaign exactly once'
);
select throws_ok(
  $$select public.queue_meta_campaign((select id from public.meta_campaigns where name = 'Disparo rastreável'))$$,
  'P0002', null, 'a queued campaign cannot be queued twice'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
create temp table first_claim as
select * from public.claim_meta_campaign_batch(
  (select id from public.meta_campaigns where name = 'Disparo rastreável'), 10
);

select is((select count(*)::integer from first_claim), 2, 'worker atomically claims an independent batch');
select is((select count(*)::integer from public.meta_campaign_recipients where status = 'queued' and attempt_count = 1), 2, 'claim starts the first attempt once');
select is((select count(distinct token_ciphertext)::integer from first_claim), 1, 'batch receives only its agency credential');

select lives_ok(format(
  $$select public.record_meta_send_result(%L, %L, false, true, 429, '4', 'Rate limit', '', '{"error":"rate_limit"}')$$,
  (select recipient_id from first_claim where phone_e164 = '+5511999999999'),
  (select processing_token from first_claim where phone_e164 = '+5511999999999')
), 'transient failure schedules a retry');
select lives_ok(format(
  $$select public.record_meta_send_result(%L, %L, false, false, 400, '100', 'Invalid number', '', '{"error":"invalid"}')$$,
  (select recipient_id from first_claim where phone_e164 = '+5511888888888'),
  (select processing_token from first_claim where phone_e164 = '+5511888888888')
), 'permanent failure is finalized without retry');

select is((select status from public.meta_campaign_recipients where phone_e164 = '+5511999999999'), 'pending', 'transient recipient returns to pending');
select is((select status from public.meta_campaign_recipients where phone_e164 = '+5511888888888'), 'failed', 'permanent recipient becomes failed');
select is((select count(*)::integer from public.meta_campaign_send_attempts), 2, 'every completed attempt is audited');

update public.meta_campaign_recipients set next_attempt_at = now() - interval '1 second'
where phone_e164 = '+5511999999999';
create temp table second_claim as
select * from public.claim_meta_campaign_batch(
  (select id from public.meta_campaigns where name = 'Disparo rastreável'), 10
);
select is((select attempt_number from second_claim), 2::smallint, 'retry increments the attempt number');
select lives_ok(format(
  $$select public.record_meta_send_result(%L, %L, true, false, 200, '', '', 'wamid.dispatch.1', '{"messaging_product":"whatsapp"}')$$,
  (select recipient_id from second_claim), (select processing_token from second_claim)
), 'accepted response persists the wamid');
select is((select meta_message_id from public.meta_campaign_recipients where phone_e164 = '+5511999999999'), 'wamid.dispatch.1', 'wamid is related to recipient');

select is(
  (select (public.record_meta_send_result(
    (select recipient_id from second_claim), (select processing_token from second_claim),
    true, false, 200, '', '', 'wamid.duplicate', '{}'
  ) ->> 'recorded')::boolean),
  false,
  'stale processing token cannot resend or duplicate an accepted recipient'
);
select is((select count(*)::integer from public.meta_campaign_send_attempts), 3, 'idempotent replay does not create another attempt');

select lives_ok(
  $$select public.finalize_meta_campaign((select id from public.meta_campaigns where name = 'Disparo rastreável'))$$,
  'worker finalizes campaign after every recipient reaches a terminal send result'
);
select is((select status from public.meta_campaigns where name = 'Disparo rastreável'), 'completed', 'campaign completes even when one number fails');
select ok((select total_count = pending_count + successful_count + failed_count from public.meta_campaigns where name = 'Disparo rastreável'), 'total always balances pending, successful and failed');

select is(
  (select (public.record_meta_delivery_event(
    'phone-dispatch-a', 'wamid.dispatch.1', 'read', now(), '', '', 'event-read-1', '{"source":"test"}'
  ) ->> 'recorded')::boolean), true, 'signed webhook service records a delivery state'
);
select is(
  (select (public.record_meta_delivery_event(
    'phone-dispatch-a', 'wamid.dispatch.1', 'delivered', now() - interval '1 minute', '', '', 'event-delivered-late', '{}'
  ) ->> 'recorded')::boolean), true, 'late unique event remains in history'
);
select is((select status from public.meta_campaign_recipients where meta_message_id = 'wamid.dispatch.1'), 'read', 'late webhook cannot regress recipient status');
select is(
  (select (public.record_meta_delivery_event(
    'phone-dispatch-a', 'wamid.dispatch.1', 'read', now(), '', '', 'event-read-1', '{}'
  ) ->> 'reason')), 'duplicate', 'duplicate webhook fingerprint is ignored'
);
select is((select count(*)::integer from public.meta_delivery_events where meta_message_id = 'wamid.dispatch.1'), 3, 'accepted, read and late delivered events form deduplicated history');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$update public.meta_campaigns set status = 'cancelled' where name = 'Disparo rastreável'$$,
  '55000', null, 'an initiated campaign cannot be cancelled'
);
select throws_ok(
  $$delete from public.meta_campaigns where name = 'Disparo rastreável'$$,
  '55000', null, 'an initiated campaign cannot be deleted'
);

select set_config('request.jwt.claim.sub', '13000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.meta_campaign_recipients), 0, 'another agency cannot see recipient results');
select is((select count(*)::integer from public.meta_campaign_send_attempts), 0, 'another agency cannot see attempt history');

select * from finish();
rollback;
