alter table public.meta_templates
  add constraint meta_templates_agency_connection_id_key
  unique (agency_id, connection_id, id);

alter table public.meta_campaigns
  add constraint meta_campaigns_approved_template_connection_fk
  foreign key (agency_id, connection_id, template_id)
  references public.meta_templates(agency_id, connection_id, id)
  on delete restrict;

create or replace function private.require_approved_meta_campaign_template()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_catalog
as $$
begin
  if exists (
    select 1
    from public.meta_templates template
    where template.id = new.template_id
      and template.agency_id = new.agency_id
      and template.status <> 'approved'
  ) then
    raise exception 'O template não está aprovado e disponível para esta conexão.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger meta_campaigns_require_approved_template
before insert or update of agency_id, connection_id, template_id
on public.meta_campaigns
for each row execute function private.require_approved_meta_campaign_template();

revoke all on function private.require_approved_meta_campaign_template()
  from public, anon, authenticated;
