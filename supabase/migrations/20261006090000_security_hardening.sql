-- Шаг 1 плана: права, журнал только на добавление, запрет каскадного удаления, общая блокировка команд.
-- Откат: supabase/rollback/20261006090000_security_hardening.down.sql

-- 1. Клиент только читает. Запись в любые таблицы и представления public идёт через pto_command.
do $$ declare r record; begin
 for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','v','m','p') loop
  execute format('revoke all on public.%I from anon',r.relname);
  execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from authenticated',r.relname);
 end loop;
end $$;

-- Новые таблицы больше не получают права anon/authenticated автоматически; select выдаётся явно в миграции.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-- 2. Журналы и снимки только на добавление.
create or replace function pto_private.forbid_change() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Запись % только на добавление: % запрещено', tg_table_name, tg_op using errcode='42501';
end $$;
revoke all on function pto_private.forbid_change() from public, anon, authenticated;

do $$ declare t text; begin
 foreach t in array array['pto_events','pto_process_events','pto_snapshots'] loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function pto_private.forbid_change()',t||'_append_only',t);
  execute format('create trigger %I before truncate on public.%I for each statement execute function pto_private.forbid_change()',t||'_no_truncate',t);
 end loop;
end $$;

-- 3. Удаление родительской записи не уносит историю и связанные данные.
alter table public.pto_counterparty_roles drop constraint pto_counterparty_roles_counterparty_id_fkey,
 add constraint pto_counterparty_roles_counterparty_id_fkey foreign key(counterparty_id) references public.pto_counterparties(id) on delete restrict;
alter table public.pto_project_participants drop constraint pto_project_participants_counterparty_id_fkey,
 add constraint pto_project_participants_counterparty_id_fkey foreign key(counterparty_id) references public.pto_counterparties(id) on delete restrict;
alter table public.pto_project_participants drop constraint pto_project_participants_project_id_fkey,
 add constraint pto_project_participants_project_id_fkey foreign key(project_id) references public.pto_projects(id) on delete restrict;
alter table public.pto_processes drop constraint pto_processes_project_id_fkey,
 add constraint pto_processes_project_id_fkey foreign key(project_id) references public.pto_projects(id) on delete restrict;
alter table public.pto_processes drop constraint pto_processes_period_id_fkey,
 add constraint pto_processes_period_id_fkey foreign key(period_id) references public.pto_periods(id) on delete restrict;
alter table public.pto_processes drop constraint pto_processes_contract_id_fkey,
 add constraint pto_processes_contract_id_fkey foreign key(contract_id) references public.pto_contracts(id) on delete restrict;
alter table public.pto_process_documents drop constraint pto_process_documents_process_id_fkey,
 add constraint pto_process_documents_process_id_fkey foreign key(process_id) references public.pto_processes(id) on delete restrict;
alter table public.pto_process_documents drop constraint pto_process_documents_document_id_fkey,
 add constraint pto_process_documents_document_id_fkey foreign key(document_id) references public.pto_documents(id) on delete restrict;
alter table public.pto_process_events drop constraint pto_process_events_process_id_fkey,
 add constraint pto_process_events_process_id_fkey foreign key(process_id) references public.pto_processes(id) on delete restrict;
alter table public.pto_process_events drop constraint pto_process_events_document_id_fkey,
 add constraint pto_process_events_document_id_fkey foreign key(document_id) references public.pto_documents(id) on delete restrict;
alter table public.pto_contract_addenda drop constraint pto_contract_addenda_contract_id_fkey,
 add constraint pto_contract_addenda_contract_id_fkey foreign key(contract_id) references public.pto_contracts(id) on delete restrict;
alter table public.pto_equipment_ttn drop constraint pto_equipment_ttn_project_id_fkey,
 add constraint pto_equipment_ttn_project_id_fkey foreign key(project_id) references public.pto_projects(id) on delete restrict;
alter table public.pto_equipment_ttn drop constraint pto_equipment_ttn_contract_id_fkey,
 add constraint pto_equipment_ttn_contract_id_fkey foreign key(contract_id) references public.pto_contracts(id) on delete restrict;

-- 4. Все команды выполняются по одной: конвейер не пересекается с закрытием периода.
create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
  when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
  when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
  when payload->>'op' in ('create_process','transition_process') then pto_private.process_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
