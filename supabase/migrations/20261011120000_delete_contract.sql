-- Удаление ошибочного договора (тред «Исправляем ошибки», 11.10.2026).
-- * Только начальник ПТО. Нельзя, если по договору есть документы, комплекты, оценки, исключения «Подписания»,
--   отметки месяца или ТТН оборудования: такие договоры правят, а не удаляют.
-- * Вместе с договором удаляются его допсоглашения и части; у дочерних договоров связь с ним снимается.
-- * В журнал (только добавление) пишется событие delete_contract со снимком договора и его ДС.
-- Откат: supabase/rollback/20261011120000_delete_contract.down.sql

create or replace function pto_private.contract_delete_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); con public.pto_contracts; result jsonb; prior pto_private.requests; snap jsonb;
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 if pto_private.my_role() is distinct from 'head' then raise exception 'Удалять договоры может начальник ПТО' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid for update;
 if not found then raise exception 'Договор не найден'; end if;
 if exists(select 1 from public.pto_documents where contract_id=con.id) or exists(select 1 from public.pto_workflows where contract_id=con.id)
  or exists(select 1 from public.pto_estimates where contract_id=con.id) or exists(select 1 from public.pto_workflow_skips where contract_id=con.id)
  or exists(select 1 from public.pto_sub_month where contract_id=con.id) or exists(select 1 from public.pto_equipment_ttn where contract_id=con.id) then
  raise exception 'По договору уже есть документы или записи месяца, удалить нельзя. Исправьте договор в карточке';
 end if;
 snap:=to_jsonb(con) || jsonb_build_object(
  'addenda',coalesce((select jsonb_agg(to_jsonb(a) order by a.agreement_date,a.created_at) from public.pto_contract_addenda a where a.contract_id=con.id),'[]'::jsonb),
  'parts',coalesce((select jsonb_agg(to_jsonb(p)) from public.pto_contract_parts p where p.contract_id=con.id),'[]'::jsonb));
 delete from public.pto_contract_addenda where contract_id=con.id;
 delete from public.pto_contract_parts where contract_id=con.id;
 delete from public.pto_contracts where id=con.id;
 insert into public.pto_events(project_id,actor,action,detail)
 values(con.project_id,who,'delete_contract',jsonb_build_object('contract_id',con.id,'number',con.number,'reason',left(trim(coalesce(body->>'reason','')),500),'contract',snap));
 result:=jsonb_build_object('project_id',con.project_id,'contract_id',con.id,'deleted',true);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.contract_delete_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.contract_delete_command(uuid,jsonb) to authenticated;

-- Диспетчер: прежний (20261011100000) + delete_contract.
create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
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
  when payload->>'op' in ('workflow_advance','workflow_return','workflow_undo','workflow_note','workflow_note_off','workflow_received',
   'workflow_start','workflow_skip','workflow_unskip') then pto_private.workflow_command(request_id,payload)
  when payload->>'op' in ('set_sub_month','set_month_marks','set_document_mark','check_file') then pto_private.month_command(request_id,payload)
  when payload->>'op'='set_contract_part' then pto_private.part_command(request_id,payload)
  when payload->>'op' in ('import_contracts','set_contract_checked') then pto_private.contract_import_command(request_id,payload)
  when payload->>'op'='delete_contract' then pto_private.contract_delete_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
