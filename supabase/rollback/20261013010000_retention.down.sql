-- Откат 20261013010000_retention: прежние pto_c3a_report (20261012230000_inspection_unblock) и pto_command (20261012200000_document_number_no_scan).
-- Удаляет поля удержаний у договоров, дату ввода объекта и журнал ручных удержаний (данные удержаний теряются).

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
  when payload->>'op'='set_document_number' then pto_private.document_number_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end
$$;

revoke all on function public.pto_command(uuid,jsonb) from public,anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

drop function if exists pto_private.retention_command(uuid,jsonb);
drop view if exists public.pto_retention_summary;
drop view if exists public.pto_retention;

-- Справка С-3а: часть договора и накопление по своей части.
drop view if exists public.pto_c3a_report;
create or replace view public.pto_c3a_report with(security_invoker=true) as
with v as (
 select v.id version_id,d.id document_id,d.project_id,d.period_id,d.contract_id,d.number,p.month,v.version,
  d.accepted_version=v.id accepted,d.current_version=v.id is_current,
  v.amount::numeric(18,2) smr,
  coalesce(v.smr_vat,0)::numeric(18,2) smr_vat,
  coalesce(v.equipment_amount,0)::numeric(18,2) equipment,
  coalesce(v.equipment_vat,0)::numeric(18,2) equipment_vat,
  coalesce(v.advance_target_offset,0)::numeric(18,2) target_offset,
  coalesce(v.advance_current_offset,0)::numeric(18,2) current_offset
 from public.pto_versions v
 join public.pto_documents d on d.id=v.document_id
 join public.pto_periods p on p.id=d.period_id
 where d.kind='c3a'
),
-- Накопление: прошлый месяц входит с шага «Проверено» (текущая версия), до него — только принятая бухгалтерией версия.
acc as (
 select v.* from v join public.pto_documents d on d.id=v.document_id
 where v.version_id=case when exists(select 1 from public.pto_workflow_documents wd join public.pto_workflows w on w.id=wd.workflow_id
   where wd.document_id=d.id and w.step_code in ('signed','accepted','closed')) then d.current_version else d.accepted_version end
)
select v.*,
 (v.smr+v.equipment-v.target_offset-v.current_offset)::numeric(18,2) to_pay,
 (y.smr+v.smr)::numeric(18,2) ytd_smr,
 (y.smr_vat+v.smr_vat)::numeric(18,2) ytd_smr_vat,
 (y.equipment+v.equipment)::numeric(18,2) ytd_equipment,
 (y.equipment_vat+v.equipment_vat)::numeric(18,2) ytd_equipment_vat,
 (y.target_offset+v.target_offset)::numeric(18,2) ytd_target_offset,
 (y.current_offset+v.current_offset)::numeric(18,2) ytd_current_offset,
 (y.smr+v.smr+y.equipment+v.equipment-y.target_offset-v.target_offset-y.current_offset-v.current_offset)::numeric(18,2) ytd_to_pay,
 (s.smr+v.smr)::numeric(18,2) total_smr,
 (s.smr_vat+v.smr_vat)::numeric(18,2) total_smr_vat,
 (s.equipment+v.equipment)::numeric(18,2) total_equipment,
 (s.equipment_vat+v.equipment_vat)::numeric(18,2) total_equipment_vat,
 (s.target_offset+v.target_offset)::numeric(18,2) total_target_offset,
 (s.current_offset+v.current_offset)::numeric(18,2) total_current_offset,
 (s.smr+v.smr+s.equipment+v.equipment-s.target_offset-v.target_offset-s.current_offset-v.current_offset)::numeric(18,2) total_to_pay,
 pp.part_id
from v
cross join lateral (select (select m.part_id from public.pto_document_marks_current m where m.document_id=v.document_id) part_id) pp
cross join lateral (select coalesce(sum(a.smr),0) smr,coalesce(sum(a.smr_vat),0) smr_vat,coalesce(sum(a.equipment),0) equipment,coalesce(sum(a.equipment_vat),0) equipment_vat,coalesce(sum(a.target_offset),0) target_offset,coalesce(sum(a.current_offset),0) current_offset from acc a where a.contract_id=v.contract_id and a.month<v.month and a.month>=date_trunc('year',v.month)::date
  and (select m.part_id from public.pto_document_marks_current m where m.document_id=a.document_id) is not distinct from pp.part_id) y
cross join lateral (select coalesce(sum(a.smr),0) smr,coalesce(sum(a.smr_vat),0) smr_vat,coalesce(sum(a.equipment),0) equipment,coalesce(sum(a.equipment_vat),0) equipment_vat,coalesce(sum(a.target_offset),0) target_offset,coalesce(sum(a.current_offset),0) current_offset from acc a where a.contract_id=v.contract_id and a.month<v.month
  and (select m.part_id from public.pto_document_marks_current m where m.document_id=a.document_id) is not distinct from pp.part_id) s;

revoke all on public.pto_c3a_report from anon, authenticated;
grant select on public.pto_c3a_report to authenticated;

drop view if exists public.pto_retention_marks_current;
drop trigger if exists pto_documents_retention_marks on public.pto_documents;
drop function if exists pto_private.retention_marks_document_deleted();
drop table if exists public.pto_retention_marks;
alter table public.pto_projects drop column if exists commissioned_on;
alter table public.pto_contracts
 drop column if exists retention_percent,
 drop column if exists retention_base,
 drop column if exists retention_first_share,
 drop column if exists retention_first_years,
 drop column if exists retention_final_years;
