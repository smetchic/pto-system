-- Шаг 9: контрагенты — импорт выписок МНС (XML).
-- import_counterparties создаёт или обновляет контрагентов по УНП. Меняются только официальные поля МНС;
-- руководитель, контакты, банк, примечание и роли не затрагиваются. Дата сведений хранится в mns_checked_at.
-- Импортируют начальник ПТО и инженеры; руководитель только читает.
-- Откат: supabase/rollback/20261007200000_counterparty_mns_import.down.sql

-- 1. Дата сведений МНС, на которую актуальны официальные поля.
alter table public.pto_counterparties add column mns_checked_at date;
update public.pto_counterparties set mns_checked_at=updated_at::date where source='МНС XML';

-- 2. Команда импорта.
create function pto_private.counterparty_import_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op'; prior pto_private.requests; result jsonb;
 r jsonb; target uuid; old_row public.pto_counterparties; created int:=0; updated int:=0; unchanged int:=0;
 checked date; v_unp text; v_short text; v_full text; changed boolean;
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

 if op='import_counterparties' then
  if jsonb_typeof(body->'rows')<>'array' or jsonb_array_length(body->'rows') not between 1 and 500 then raise exception 'Нет строк для импорта (не более 500 за раз)'; end if;
  checked:=coalesce(nullif(body->>'checked_at','')::date,current_date);
  for r in select * from jsonb_array_elements(body->'rows') loop
   v_unp:=trim(coalesce(r->>'unp',''));v_short:=trim(coalesce(r->>'short_name',''));v_full:=trim(coalesce(r->>'full_name',''));
   if v_unp !~ '^[0-9]{9}$' then raise exception 'УНП должен содержать 9 цифр: %',v_unp; end if;
   if length(v_full)=0 then raise exception 'Нет полного наименования для УНП %',v_unp; end if;
   if length(v_short)=0 then v_short:=v_full; end if;
   select * into old_row from public.pto_counterparties where unp=v_unp for update;
   if not found then
    insert into public.pto_counterparties(unp,short_name,full_name,address,registration_date,tax_office_code,tax_office_name,status_code,status_name,status_change_date,liquidation_info,source,mns_checked_at)
    values(v_unp,v_short,v_full,trim(coalesce(r->>'address','')),nullif(r->>'registration_date','')::date,trim(coalesce(r->>'tax_office_code','')),trim(coalesce(r->>'tax_office_name','')),
     trim(coalesce(r->>'status_code','')),trim(coalesce(r->>'status_name','')),nullif(r->>'status_change_date','')::date,trim(coalesce(r->>'liquidation_info','')),'МНС XML',checked)
    returning id into target;
    created:=created+1;
    insert into public.pto_events(project_id,actor,action,detail) values(null,who,'import_counterparty',jsonb_build_object('counterparty_id',target,'unp',v_unp,'result','created','checked_at',checked));
   else
    changed:=(old_row.short_name,old_row.full_name,old_row.address,old_row.registration_date,old_row.tax_office_code,old_row.tax_office_name,old_row.status_code,old_row.status_name,old_row.status_change_date,old_row.liquidation_info)
     is distinct from (v_short,v_full,trim(coalesce(r->>'address','')),nullif(r->>'registration_date','')::date,trim(coalesce(r->>'tax_office_code','')),trim(coalesce(r->>'tax_office_name','')),
     trim(coalesce(r->>'status_code','')),trim(coalesce(r->>'status_name','')),nullif(r->>'status_change_date','')::date,trim(coalesce(r->>'liquidation_info','')));
    -- Только официальные поля МНС; руководитель, контакты, банк, примечание и роли остаются как были.
    update public.pto_counterparties set short_name=v_short,full_name=v_full,address=trim(coalesce(r->>'address','')),registration_date=nullif(r->>'registration_date','')::date,
     tax_office_code=trim(coalesce(r->>'tax_office_code','')),tax_office_name=trim(coalesce(r->>'tax_office_name','')),status_code=trim(coalesce(r->>'status_code','')),
     status_name=trim(coalesce(r->>'status_name','')),status_change_date=nullif(r->>'status_change_date','')::date,liquidation_info=trim(coalesce(r->>'liquidation_info','')),
     source='МНС XML',mns_checked_at=greatest(checked,old_row.mns_checked_at),updated_at=case when changed then now() else updated_at end
    where id=old_row.id;
    if changed then
     updated:=updated+1;
     insert into public.pto_events(project_id,actor,action,detail) values(null,who,'import_counterparty',jsonb_build_object('counterparty_id',old_row.id,'unp',v_unp,'result','updated','checked_at',checked,
      'before',jsonb_build_object('short_name',old_row.short_name,'full_name',old_row.full_name,'address',old_row.address,'status_name',old_row.status_name,'status_change_date',old_row.status_change_date,'liquidation_info',old_row.liquidation_info)));
    else unchanged:=unchanged+1;
    end if;
   end if;
  end loop;
  result:=jsonb_build_object('created',created,'updated',updated,'unchanged',unchanged);
 else
  raise exception 'Неизвестная операция';
 end if;
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.counterparty_import_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.counterparty_import_command(uuid,jsonb) to authenticated;

-- 3. Диспетчер команд.
create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
  when payload->>'op' in ('update_contract','create_addendum','set_addendum_status') then pto_private.contract_command(request_id,payload)
  when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
  when payload->>'op' ='import_counterparties' then pto_private.counterparty_import_command(request_id,payload)
  when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
  when payload->>'op'='set_theme' then pto_private.profile_command(request_id,payload)
  when payload->>'op'='set_estimate' then pto_private.estimate_command(request_id,payload)
  when payload->>'op' in ('workflow_advance','workflow_return') then pto_private.workflow_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
