-- Откат миграции 20261010210000_month_marks.sql: убирает отметки месяца, документов и сверку сканов.
-- Внимание: удаляет все записи этих таблиц (журнал отметок). Диспетчер команд — из 20261008220000.
-- После выполнения удалить запись версии 20261010210000 из supabase_migrations.schema_migrations.

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
  when payload->>'op' in ('update_contract','create_addendum','set_addendum_status') then pto_private.contract_command(request_id,payload)
  when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
  when payload->>'op'='import_counterparties' then pto_private.counterparty_import_command(request_id,payload)
  when payload->>'op' in ('save_counterparty_contact','delete_counterparty_contact') then pto_private.counterparty_contact_command(request_id,payload)
  when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
  when payload->>'op' in ('set_theme','set_text_scale') then pto_private.profile_command(request_id,payload)
  when payload->>'op'='set_estimate' then pto_private.estimate_command(request_id,payload)
  when payload->>'op' in ('workflow_advance','workflow_return','workflow_undo','workflow_note','workflow_note_off','workflow_received',
   'workflow_start','workflow_skip','workflow_unskip') then pto_private.workflow_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

drop function pto_private.month_command(uuid,jsonb);
drop view public.pto_sub_month_current, public.pto_month_marks_current, public.pto_document_marks_current, public.pto_file_checks_current;
drop table public.pto_file_checks, public.pto_document_marks, public.pto_month_marks, public.pto_sub_month;
