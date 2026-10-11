-- Карточки договора, ДС и частей (замечания пользователя 11.10.2026).
-- * Пути к файлам договора (files) правятся в карточке: команда set_contract_files, по одному пути в строке.
-- * Ставка НДС не вводится, а считается из суммы и НДС; у части договора теперь хранится НДС (vat_amount),
--   ставка (vat_rate) остаётся для реестра и подписей и пишется посчитанной.
-- Откат: supabase/rollback/20261011200000_contract_files_part_vat.down.sql

alter table public.pto_contract_parts add column vat_amount numeric(18,2) check (vat_amount is null or vat_amount>=0);
-- У прежних частей НДС считается из стоимости и ставки.
update public.pto_contract_parts set vat_amount=round(amount*vat_rate/(100+vat_rate),2) where vat_amount is null and amount is not null and vat_rate is not null;

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
  insert into public.pto_contract_parts(project_id,contract_id,name,vat_rate,amount,vat_amount,ordinal,created_by)
  values(con.project_id,con.id,v_name,pto_private.money_arg(body->>'vat_rate','ставка НДС'),pto_private.money_arg(body->>'amount','стоимость части'),pto_private.money_arg(body->>'vat_amount','НДС части'),
   coalesce((select max(ordinal)+1 from public.pto_contract_parts where contract_id=con.id),1),who) returning id into target;
 else
  update public.pto_contract_parts set name=v_name,
   vat_rate=case when body ? 'vat_rate' then pto_private.money_arg(body->>'vat_rate','ставка НДС') else vat_rate end,
   amount=case when body ? 'amount' then pto_private.money_arg(body->>'amount','стоимость части') else amount end,
   vat_amount=case when body ? 'vat_amount' then pto_private.money_arg(body->>'vat_amount','НДС части') else vat_amount end,
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

-- Пути к файлам договора в папке ДОГОВОРА: правят начальник ПТО и инженер объекта. Тип файла сохраняется у прежних путей.
create or replace function pto_private.contract_files_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; con public.pto_contracts; result jsonb; prior pto_private.requests; v_files jsonb;
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
 select * into con from public.pto_contracts where id=nullif(body->>'contract_id','')::uuid for update;
 if not found then raise exception 'Договор не найден'; end if;
 if not coalesce(pto_private.can_access(con.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 if jsonb_typeof(body->'files') is distinct from 'array' then raise exception 'Список файлов: массив путей'; end if;
 if exists(select 1 from jsonb_array_elements(body->'files') x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 500) then
  raise exception 'Путь к файлу: от 1 до 500 знаков';
 end if;
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('path',p.path,'type',(select o->>'type' from jsonb_array_elements(con.files) o where o->>'path'=p.path limit 1))) order by p.ord),'[]'::jsonb)
 into v_files
 from (select distinct on (trim(x#>>'{}')) trim(x#>>'{}') path,ord from jsonb_array_elements(body->'files') with ordinality t(x,ord) order by trim(x#>>'{}'),ord) p;
 update public.pto_contracts set files=v_files where id=con.id;
 insert into public.pto_events(project_id,actor,action,detail) values(con.project_id,who,'set_contract_files',body);
 result:=jsonb_build_object('project_id',con.project_id,'contract_id',con.id,'files',jsonb_array_length(v_files));
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.contract_files_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.contract_files_command(uuid,jsonb) to authenticated;

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
  when payload->>'op'='set_contract_files' then pto_private.contract_files_command(request_id,payload)
  when payload->>'op' in ('set_sub_month','set_month_marks','set_document_mark','check_file') then pto_private.month_command(request_id,payload)
  when payload->>'op'='set_contract_part' then pto_private.part_command(request_id,payload)
  when payload->>'op' in ('import_contracts','set_contract_checked') then pto_private.contract_import_command(request_id,payload)
  when payload->>'op'='delete_contract' then pto_private.contract_delete_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
