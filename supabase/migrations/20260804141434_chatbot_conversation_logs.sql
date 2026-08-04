alter table public.chatbot_interactions
  add column external_session_id text
  check (external_session_id is null or char_length(external_session_id) <= 200);

create index chatbot_interactions_agency_session_idx
  on public.chatbot_interactions(agency_id, external_session_id)
  where external_session_id is not null;
