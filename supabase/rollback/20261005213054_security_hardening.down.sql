-- Откат миграции 20261005213054_security_hardening.sql: возвращает состояние базы до её применения.
-- После выполнения удалить запись версии 20261005213054 из supabase_migrations.schema_migrations.

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language sql set search_path='' as $$
  select case
    when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
    when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
    when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
    when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
    when payload->>'op' in ('create_process','transition_process') then pto_private.process_command(request_id,payload)
    else pto_private.command(request_id,payload)
  end;
$$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

alter table public.pto_counterparty_roles drop constraint pto_counterparty_roles_counterparty_id_fkey,
 add constraint pto_counterparty_roles_counterparty_id_fkey foreign key(counterparty_id) references public.pto_counterparties(id) on delete cascade;
alter table public.pto_project_participants drop constraint pto_project_participants_counterparty_id_fkey,
 add constraint pto_project_participants_counterparty_id_fkey foreign key(counterparty_id) references public.pto_counterparties(id) on delete cascade;
alter table public.pto_project_participants drop constraint pto_project_participants_project_id_fkey,
 add constraint pto_project_participants_project_id_fkey foreign key(project_id) references public.pto_projects(id) on delete cascade;
alter table public.pto_processes drop constraint pto_processes_project_id_fkey,
 add constraint pto_processes_project_id_fkey foreign key(project_id) references public.pto_projects(id) on delete cascade;
alter table public.pto_processes drop constraint pto_processes_period_id_fkey,
 add constraint pto_processes_period_id_fkey foreign key(period_id) references public.pto_periods(id) on delete cascade;
alter table public.pto_processes drop constraint pto_processes_contract_id_fkey,
 add constraint pto_processes_contract_id_fkey foreign key(contract_id) references public.pto_contracts(id) on delete cascade;
alter table public.pto_process_documents drop constraint pto_process_documents_process_id_fkey,
 add constraint pto_process_documents_process_id_fkey foreign key(process_id) references public.pto_processes(id) on delete cascade;
alter table public.pto_process_documents drop constraint pto_process_documents_document_id_fkey,
 add constraint pto_process_documents_document_id_fkey foreign key(document_id) references public.pto_documents(id) on delete cascade;
alter table public.pto_process_events drop constraint pto_process_events_process_id_fkey,
 add constraint pto_process_events_process_id_fkey foreign key(process_id) references public.pto_processes(id) on delete cascade;
alter table public.pto_process_events drop constraint pto_process_events_document_id_fkey,
 add constraint pto_process_events_document_id_fkey foreign key(document_id) references public.pto_documents(id) on delete set null;
alter table public.pto_contract_addenda drop constraint pto_contract_addenda_contract_id_fkey,
 add constraint pto_contract_addenda_contract_id_fkey foreign key(contract_id) references public.pto_contracts(id) on delete cascade;
alter table public.pto_equipment_ttn drop constraint pto_equipment_ttn_project_id_fkey,
 add constraint pto_equipment_ttn_project_id_fkey foreign key(project_id) references public.pto_projects(id) on delete cascade;
alter table public.pto_equipment_ttn drop constraint pto_equipment_ttn_contract_id_fkey,
 add constraint pto_equipment_ttn_contract_id_fkey foreign key(contract_id) references public.pto_contracts(id) on delete cascade;

do $$ declare t text; begin
 foreach t in array array['pto_events','pto_process_events','pto_snapshots'] loop
  execute format('drop trigger if exists %I on public.%I',t||'_append_only',t);
  execute format('drop trigger if exists %I on public.%I',t||'_no_truncate',t);
 end loop;
end $$;
drop function if exists pto_private.forbid_change();

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to public, anon;

-- Права, существовавшие до миграции (выданы по умолчанию при создании этих объектов).
grant all on public.pto_contract_addenda, public.pto_equipment_ttn to anon, authenticated;
grant insert,update,delete,truncate,references,trigger on public.pto_register to authenticated;
