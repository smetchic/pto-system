-- Откат миграции 20261007200000_counterparty_import_and_files.sql: убирает импорт выписок МНС и файлы контрагента.
-- Диспетчер команд — из миграции 20261005230629. Загруженные в хранилище файлы counterparties/* остаются,
-- но становятся недоступны клиентам (политики чтения удаляются); при необходимости удалить их из bucket вручную.
-- После выполнения удалить запись версии 20261007200000 из supabase_migrations.schema_migrations.

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
  when payload->>'op' in ('update_contract','create_addendum','set_addendum_status') then pto_private.contract_command(request_id,payload)
  when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
  when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
  when payload->>'op'='set_theme' then pto_private.profile_command(request_id,payload)
  when payload->>'op'='set_estimate' then pto_private.estimate_command(request_id,payload)
  when payload->>'op' in ('workflow_advance','workflow_return') then pto_private.workflow_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

drop function pto_private.counterparty_files_command(uuid,jsonb);
drop policy pto_counterparty_file_upload on storage.objects;
drop policy pto_counterparty_file_read on storage.objects;
drop table public.pto_counterparty_files;
alter table public.pto_counterparties drop column mns_checked_at;
