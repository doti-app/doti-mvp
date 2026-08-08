-- A decisão é o evento de negócio que move uma demanda de etapa. Publicá-la
-- garante que quadros internos já abertos recebam a atualização imediatamente.
do $$
begin
  alter publication supabase_realtime add table public.client_approval_decisions;
exception
  when duplicate_object then null;
end;
$$;
