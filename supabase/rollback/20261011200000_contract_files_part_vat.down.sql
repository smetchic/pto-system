-- Откат 20261011200000_contract_files_part_vat.sql.
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
  when payload->>'op'='workflow_jump' then pto_private.workflow_jump_command(request_id,payload)
  when payload->>'op' in ('set_sub_month','set_month_marks','set_document_mark','check_file') then pto_private.month_command(request_id,payload)
  when payload->>'op'='set_contract_part' then pto_private.part_command(request_id,payload)
  when payload->>'op' in ('import_contracts','set_contract_checked') then pto_private.contract_import_command(request_id,payload)
  when payload->>'op'='delete_contract' then pto_private.contract_delete_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

drop function pto_private.contract_files_command(uuid,jsonb);
create or replace function pto_private.part_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; con public.pto_contracts; part public.pto_contract_parts;
 target uuid; result jsonb; prior pto_private.requests; v_name text:=trim(coalesce(body->>'name',''));
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 role_name:=pto_private.my_role();
 if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 if nullif(body->>'part_id','') is not null then
  select * into part from public.pto_contract_parts where id=(body->>'part_id')::uuid for update;
  if not found then raise exception 'Часть договора не найдена'; end if;
  select * into con from public.pto_contracts where id=part.contract_id;
 else
  select * into con from public.pto_contracts where id=nullif(body->>'contract_id','')::uuid;
  if not found then raise exception 'Договор не найден'; end if;
 end if;
 if not coalesce(pto_private.can_access(con.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 if length(v_name) not between 1 and 200 then raise exception 'Укажите название части (до 200 знаков)'; end if;
 if part.id is null then
  insert into public.pto_contract_parts(project_id,contract_id,name,vat_rate,amount,ordinal,created_by)
  values(con.project_id,con.id,v_name,pto_private.money_arg(body->>'vat_rate','ставка НДС'),pto_private.money_arg(body->>'amount','стоимость части'),
   coalesce((select max(ordinal)+1 from public.pto_contract_parts where contract_id=con.id),1),who) returning id into target;
 else
  update public.pto_contract_parts set name=v_name,
   vat_rate=case when body ? 'vat_rate' then pto_private.money_arg(body->>'vat_rate','ставка НДС') else vat_rate end,
   amount=case when body ? 'amount' then pto_private.money_arg(body->>'amount','стоимость части') else amount end,
   active=case when body ? 'active' then coalesce((body->>'active')::boolean,true) else active end,
   updated_at=now()
  where id=part.id returning id into target;
 end if;
 insert into public.pto_events(project_id,actor,action,detail) values(con.project_id,who,'set_contract_part',body||jsonb_build_object('part_id',target));
 result:=jsonb_build_object('project_id',con.project_id,'contract_id',con.id,'part_id',target);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.part_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.part_command(uuid,jsonb) to authenticated;
alter table public.pto_contract_parts drop column vat_amount;
