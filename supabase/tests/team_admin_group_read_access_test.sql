begin;

create extension if not exists pgtap;
select plan(4);

select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'public.agency_groups'::regclass),
  'agency groups keep row level security enabled'
);
select ok(
  has_table_privilege('service_role', 'public.agency_groups', 'SELECT'),
  'team administration can read agency groups'
);
select ok(
  not has_table_privilege('service_role', 'public.agency_groups', 'INSERT')
    and not has_table_privilege('service_role', 'public.agency_groups', 'UPDATE')
    and not has_table_privilege('service_role', 'public.agency_groups', 'DELETE'),
  'team administration cannot write agency groups through the service role'
);
select ok(
  not has_table_privilege('anon', 'public.agency_groups', 'SELECT'),
  'anonymous clients cannot read agency groups'
);

select * from finish();
rollback;
