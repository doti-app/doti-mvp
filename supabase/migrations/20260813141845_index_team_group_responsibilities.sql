-- Cover the composite foreign keys used when loading group assignments by agency.

create index if not exists profile_group_responsibilities_agency_profile_idx
  on public.profile_group_responsibilities (agency_id, profile_id);

create index if not exists invitation_group_responsibilities_agency_invitation_idx
  on public.invitation_group_responsibilities (agency_id, invitation_id);
