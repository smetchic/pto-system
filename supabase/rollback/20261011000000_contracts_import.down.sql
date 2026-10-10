-- Откат миграции 20261011000000_contracts_import.sql. Загруженные договоры, объекты и контрагенты остаются,
-- удаляются только новые поля договора (вид, «проверен», ключ папки, статус, файлы, аванс).
-- После выполнения удалить запись версии 20261011000000 из supabase_migrations.schema_migrations.

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
  when payload->>'op' in ('set_sub_month','set_month_marks','set_document_mark','check_file') then pto_private.month_command(request_id,payload)
  when payload->>'op'='set_contract_part' then pto_private.part_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

drop function pto_private.contract_import_command(uuid,jsonb);
drop view public.pto_contract_list;
drop index public.pto_contracts_source_key_key;
alter table public.pto_contracts drop column contract_type, drop column checked, drop column source_key, drop column doc_status,
 drop column replaced_by, drop column note, drop column files, drop column advance_current_percent, drop column advance_target_amount;
create view public.pto_contract_list with(security_invoker=true) as
select c.*,
 coalesce(cp.short_name,c.party_text) party,
 coalesce(am.amount_after,c.initial_amount) current_amount,
 case when am.id is not null then am.vat_amount else c.vat_amount end current_vat_amount,
 coalesce(te.work_end_date,c.work_end_date) current_end_date,
 am.number amount_addendum_number, am.agreement_date amount_addendum_date,
 te.number term_addendum_number, te.agreement_date term_addendum_date,
 (select count(*) from public.pto_contract_addenda a where a.contract_id=c.id and a.status='signed')::int signed_addenda
from public.pto_contracts c
left join public.pto_counterparties cp on cp.id=c.counterparty_id
left join lateral (select a.* from public.pto_contract_addenda a where a.contract_id=c.id and a.status='signed' and a.amount_after is not null
 order by a.agreement_date desc,a.created_at desc limit 1) am on true
left join lateral (select a.* from public.pto_contract_addenda a where a.contract_id=c.id and a.status='signed' and a.work_end_date is not null
 order by a.agreement_date desc,a.created_at desc limit 1) te on true;
revoke all on public.pto_contract_list from anon, authenticated;
grant select on public.pto_contract_list to authenticated;
