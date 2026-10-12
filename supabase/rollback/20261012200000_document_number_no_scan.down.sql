-- Откат 20261012200000_document_number_no_scan: скан снова обязателен для передачи в бухгалтерию, команды смены номера нет.
-- Уже изменённые номера документов остаются (журнал хранит прежние).

update public.pto_workflow_steps set requires=case template_code when 'sub_claim' then '{kit,files,person,proof,accept}'::text[] else '{kit,files,person,accept}'::text[] end
where code='accepted';

create or replace function public.pto_command(request_id uuid,payload jsonb)
returns jsonb
language plpgsql
set search_path=''
as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='update_project' then pto_private.project_command(request_id,payload)
  when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
  when payload->>'op' in ('update_contract','create_addendum','set_addendum_status','update_addendum') then pto_private.contract_command(request_id,payload)
  when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
  when payload->>'op'='import_counterparties' then pto_private.counterparty_import_command(request_id,payload)
  when payload->>'op' in ('save_counterparty_contact','delete_counterparty_contact') then pto_private.counterparty_contact_command(request_id,payload)
  when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
  when payload->>'op' in ('set_theme','set_text_scale') then pto_private.profile_command(request_id,payload)
  when payload->>'op'='set_estimate' then pto_private.estimate_command(request_id,payload)
  when payload->>'op' in ('workflow_advance','workflow_return','workflow_undo','workflow_note','workflow_note_off','workflow_received','workflow_start','workflow_skip','workflow_unskip') then pto_private.workflow_command(request_id,payload)
  when payload->>'op'='workflow_redate' then pto_private.workflow_redate_command(request_id,payload)
  when payload->>'op'='workflow_jump' then pto_private.workflow_jump_command(request_id,payload)
  when payload->>'op'='set_contract_files' then pto_private.contract_files_command(request_id,payload)
  when payload->>'op' in ('set_sub_month','set_month_marks','set_document_mark','check_file') then pto_private.month_command(request_id,payload)
  when payload->>'op'='set_contract_part' then pto_private.part_command(request_id,payload)
  when payload->>'op' in ('import_contracts','set_contract_checked') then pto_private.contract_import_command(request_id,payload)
  when payload->>'op'='delete_contract' then pto_private.contract_delete_command(request_id,payload)
  when payload->>'op'='delete_document' then pto_private.delete_wrong_document((payload->>'document_id')::uuid,payload->>'reason')
  else pto_private.command(request_id,payload)
 end;
end
$$;

revoke all on function public.pto_command(uuid,jsonb) from public,anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

drop function if exists pto_private.document_number_command(uuid,jsonb);
