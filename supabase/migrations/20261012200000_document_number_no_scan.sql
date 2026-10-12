-- Решения пользователя 12.10.2026 (тред «Изменить в карточке документа»):
-- 1. Номер документа правится в карточке («Изменить»). Команда set_document_number: журнал только дополняется
--    (в событии старый номер), месяц уходит на повторную проверку. Изменение комплекта после отправки или проверки
--    даёт замечание, комплект в бухгалтерии не меняется (как при новой версии суммы, pto_private.workflow_link).
--    Скан, отметки, шаг и история версий остаются у того же документа.
-- 2. Скан не обязателен для передачи в бухгалтерию: в бухгалтерию идёт оригинал, скан нужен ПТО для контроля
--    и прикладывается и после передачи, пока месяц не закрыт (20261011210000_document_card).
-- Откат: supabase/rollback/20261012200000_document_number_no_scan.down.sql

update public.pto_workflow_steps set requires=array_remove(requires,'files') where code='accepted';

create or replace function pto_private.document_number_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; prior pto_private.requests; result jsonb;
 doc public.pto_documents; per public.pto_periods; old_number text; new_number text:=trim(coalesce(body->>'number',''));
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 role_name:=pto_private.my_role();
 if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 if role_name not in ('head','engineer') then raise exception 'Нет права редактировать документы' using errcode='42501'; end if;
 if length(new_number)=0 then raise exception 'Укажите номер'; end if;
 if length(new_number)>100 then raise exception 'Слишком длинный номер'; end if;
 select * into doc from public.pto_documents where id=(body->>'document_id')::uuid for update;
 if not found then raise exception 'Документ не найден'; end if;
 if not coalesce(pto_private.can_access(doc.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 select * into per from public.pto_periods where id=doc.period_id for update;
 if per.status<>'open' then raise exception 'Месяц закрыт: номер не изменить'; end if;
 old_number:=doc.number;
 if old_number=new_number then raise exception 'Номер не изменился'; end if;
 update public.pto_documents set number=new_number where id=doc.id;
 perform pto_private.workflow_link(doc.id,who,'номер изменён: '||old_number||' → '||new_number);
 update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id;
 insert into public.pto_events(project_id,period_id,document_id,actor,action,detail)
 values(doc.project_id,doc.period_id,doc.id,who,'set_document_number',body || jsonb_build_object('was',old_number));
 result:=jsonb_build_object('document_id',doc.id,'number',new_number,'was',old_number);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.document_number_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.document_number_command(uuid,jsonb) to authenticated;

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
