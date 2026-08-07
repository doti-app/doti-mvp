begin;

create extension if not exists pgtap;
select plan(25);

insert into auth.users (id, email)
values
  ('11000000-0000-4000-8000-000000000001', 'meta-owner-a@doti.test'),
  ('11000000-0000-4000-8000-000000000002', 'meta-admin-a@doti.test'),
  ('11000000-0000-4000-8000-000000000003', 'meta-member-a@doti.test'),
  ('11000000-0000-4000-8000-000000000004', 'meta-viewer-a@doti.test'),
  ('11000000-0000-4000-8000-000000000005', 'meta-owner-b@doti.test');

insert into public.agencies (id, name, owner_id)
values
  ('21000000-0000-4000-8000-000000000001', 'Meta Agência A', '11000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000002', 'Meta Agência B', '11000000-0000-4000-8000-000000000005');

update public.profiles p
set
  agency_id = fixture.agency_id,
  full_name = fixture.full_name,
  agency_name = fixture.agency_name,
  role = fixture.role,
  is_active = true
from (
  values
    ('11000000-0000-4000-8000-000000000001'::uuid, '21000000-0000-4000-8000-000000000001'::uuid, 'Meta Owner A', 'Meta Agência A', 'owner'),
    ('11000000-0000-4000-8000-000000000002'::uuid, '21000000-0000-4000-8000-000000000001'::uuid, 'Meta Admin A', 'Meta Agência A', 'admin'),
    ('11000000-0000-4000-8000-000000000003'::uuid, '21000000-0000-4000-8000-000000000001'::uuid, 'Meta Member A', 'Meta Agência A', 'member'),
    ('11000000-0000-4000-8000-000000000004'::uuid, '21000000-0000-4000-8000-000000000001'::uuid, 'Meta Viewer A', 'Meta Agência A', 'viewer'),
    ('11000000-0000-4000-8000-000000000005'::uuid, '21000000-0000-4000-8000-000000000002'::uuid, 'Meta Owner B', 'Meta Agência B', 'owner')
) as fixture(id, agency_id, full_name, agency_name, role)
where p.id = fixture.id;

select public.configure_meta_whatsapp_rollout(
  '21000000-0000-4000-8000-000000000001', 'general', true, array[]::text[]
);

delete from public.agencies
where id not in (
  '21000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000002'
);

insert into public.meta_connections (
  id, agency_id, name, whatsapp_business_account_id, phone_number_id,
  created_by, updated_by
)
values (
  '31000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000002',
  'Conexão B',
  'waba-b',
  'phone-b',
  '11000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000005'
);

select hasnt_column(
  'public', 'meta_connections', 'access_token',
  'public connection metadata never exposes an access token column'
);

select hasnt_column(
  'public', 'meta_connections', 'token_ciphertext',
  'public connection metadata never exposes ciphertext'
);

select ok(
  not has_table_privilege('authenticated', 'private.meta_connection_credentials', 'SELECT'),
  'authenticated clients cannot read encrypted credentials'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.store_meta_connection_secret(uuid,uuid,text,text,text,text,text,timestamptz,text,text,smallint,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the secret-storage RPC'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.store_meta_connection_secret(uuid,uuid,text,text,text,text,text,timestamptz,text,text,smallint,uuid)',
    'EXECUTE'
  ),
  'only the server service role can call the secret-storage RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$insert into public.meta_connections (
      id, agency_id, name, whatsapp_business_account_id, phone_number_id
    ) values (
      '31000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      'Conexão A',
      'waba-a',
      'phone-a'
    )$$,
  'owner can configure its agency connection metadata'
);

select is(
  (
    select created_by
    from public.meta_connections
    where id = '31000000-0000-4000-8000-000000000001'
  ),
  '11000000-0000-4000-8000-000000000001'::uuid,
  'administrative author is recorded automatically'
);

select is(
  (
    select actor_id
    from public.meta_admin_audit_events
    where entity_id = '31000000-0000-4000-8000-000000000001'
      and action = 'created'
  ),
  '11000000-0000-4000-8000-000000000001'::uuid,
  'audit trail records the administrative actor'
);

select ok(
  (
    select created_at <= now()
    from public.meta_admin_audit_events
    where entity_id = '31000000-0000-4000-8000-000000000001'
      and action = 'created'
  ),
  'audit trail records the administrative timestamp'
);

select is(
  (select count(*)::integer from public.meta_connections),
  1,
  'owner cannot query another agency connection'
);

select is_empty(
  $$update public.meta_connections
    set name = 'Ataque'
    where id = '31000000-0000-4000-8000-000000000002'
    returning id$$,
  'owner cannot alter another agency connection'
);

select throws_ok(
  $$select * from private.meta_connection_credentials$$,
  '42501',
  null,
  'browser role cannot access the private credential table'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$insert into public.meta_templates (
      id, agency_id, connection_id, meta_template_id, name,
      language, category, status
    ) values (
      '41000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      'template-a',
      'boas_vindas',
      'pt_BR',
      'utility',
      'approved'
    )$$,
  'admin can synchronize template metadata'
);

select lives_ok(
  $$insert into public.meta_campaigns (
      id, agency_id, connection_id, template_id, name
    ) values (
      '51000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001',
      'Campanha A'
    )$$,
  'admin can create a campaign'
);

select lives_ok(
  $$insert into public.meta_campaign_recipients (
      id, agency_id, campaign_id, phone_e164
    ) values (
      '61000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      '+5511999999999'
    )$$,
  'admin can add campaign recipients'
);

select lives_ok(
  $$select public.queue_meta_campaign(
    '51000000-0000-4000-8000-000000000001'
  )$$,
  'admin can queue a campaign for server dispatch'
);

select is(
  (
    select status
    from public.meta_campaigns
    where id = '51000000-0000-4000-8000-000000000001'
  ),
  'queued',
  'campaign queue action changes status'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);

select is(
  (select count(*)::integer from public.meta_campaigns),
  1,
  'member can read only campaign data from its own agency'
);

select throws_ok(
  $$insert into public.meta_campaigns (
      agency_id, connection_id, template_id, name
    ) values (
      '21000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001',
      'Campanha bloqueada'
    )$$,
  '42501',
  null,
  'member cannot configure campaigns'
);

select throws_ok(
  $$select public.queue_meta_campaign(
    '51000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  null,
  'member cannot dispatch campaigns'
);

select is(
  (select count(*)::integer from public.meta_admin_audit_events),
  0,
  'member cannot read administrative audit events'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000004', true);

select is_empty(
  $$update public.meta_connections
    set name = 'Viewer bloqueado'
    where id = '31000000-0000-4000-8000-000000000001'
    returning id$$,
  'viewer cannot configure connections'
);

select throws_ok(
  $$select public.queue_meta_campaign(
    '51000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  null,
  'viewer cannot dispatch campaigns'
);

select throws_ok(
  $$insert into public.meta_delivery_events (
      agency_id, connection_id, campaign_id, recipient_id,
      event_type, occurred_at
    ) values (
      '21000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      'delivered',
      now()
    )$$,
  '42501',
  null,
  'browser roles cannot forge delivery events'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$insert into public.meta_campaigns (
      agency_id, connection_id, template_id, name
    ) values (
      '21000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000001',
      'Campanha cruzada'
    )$$,
  '23503',
  null,
  'composite foreign keys reject cross-agency Meta relationships'
);

select * from finish();
rollback;
