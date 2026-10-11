-- Откат 20261011100000_roles_levels_engineer_addenda: прежние функции договора, объекта, контрагента и диспетчер,
-- представление списка договоров без новых полей; колонки уровня, ролей, инженера объекта и скана ДС удаляются.
-- Цвета объектов остаются новыми (прежние цвета не восстанавливаются, их можно выбрать в карточке объекта).
drop view public.pto_contract_list;
drop trigger pto_contracts_sides on public.pto_contracts;
drop function pto_private.contract_sides();
alter table public.pto_contracts drop column chain_level, drop column our_side, drop column party_side;
alter table public.pto_contract_addenda drop column scan_path;
alter table public.pto_projects drop column engineer_id;
delete from public.pto_counterparty_roles where role='contractor';
alter table public.pto_counterparty_roles drop constraint pto_counterparty_roles_role_check;
alter table public.pto_counterparty_roles add constraint pto_counterparty_roles_role_check
 check (role in ('customer','general_contractor','subcontractor','supplier','service_provider'));
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

create or replace function pto_private.contract_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op';
 con public.pto_contracts; adm public.pto_contract_addenda; target uuid; parent uuid;
 new_status text; result jsonb; prior pto_private.requests;
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

 if op='set_addendum_status' then
  select * into adm from public.pto_contract_addenda where id=(body->>'addendum_id')::uuid for update;
  if not found then raise exception 'Допсоглашение не найдено'; end if;
  select * into con from public.pto_contracts where id=adm.contract_id for update;
 else
  select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid for update;
  if not found then raise exception 'Договор не найден'; end if;
 end if;
 if not coalesce(pto_private.can_access(con.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;

 if op='update_contract' then
  if length(trim(coalesce(body->>'number','')))=0 then raise exception 'Укажите номер договора'; end if;
  parent:=nullif(body->>'parent_contract_id','')::uuid;
  if parent is not null and (parent=con.id or not exists(select 1 from public.pto_contracts p where p.id=parent and p.project_id=con.project_id)) then
   raise exception 'Основной договор должен относиться к тому же объекту';
  end if;
  update public.pto_contracts set
   number=trim(body->>'number'),
   contract_date=nullif(body->>'contract_date','')::date,
   subject=trim(coalesce(body->>'subject','')),
   parent_contract_id=parent,
   initial_amount=pto_private.money_arg(body->>'initial_amount','договорная цена'),
   vat_rate=pto_private.money_arg(body->>'vat_rate','ставка НДС'),
   vat_amount=pto_private.money_arg(body->>'vat_amount','НДС'),
   smr_amount=pto_private.money_arg(body->>'smr_amount','СМР'),
   smr_vat_amount=pto_private.money_arg(body->>'smr_vat_amount','НДС СМР'),
   pnr_amount=pto_private.money_arg(body->>'pnr_amount','ПНР'),
   pnr_vat_amount=pto_private.money_arg(body->>'pnr_vat_amount','НДС ПНР'),
   equipment_amount=pto_private.money_arg(body->>'equipment_amount','оборудование'),
   equipment_vat_amount=pto_private.money_arg(body->>'equipment_vat_amount','НДС оборудования'),
   work_start_date=nullif(body->>'work_start_date','')::date,
   work_end_date=nullif(body->>'work_end_date','')::date
  where id=con.id;
 elsif op='create_addendum' then
  if length(trim(coalesce(body->>'number','')))=0 then raise exception 'Укажите номер допсоглашения'; end if;
  if nullif(body->>'agreement_date','') is null then raise exception 'Укажите дату допсоглашения'; end if;
  new_status:=coalesce(nullif(body->>'status',''),'draft');
  if new_status not in ('draft','signed') then raise exception 'Новое допсоглашение — проект или подписанное'; end if;
  insert into public.pto_contract_addenda(contract_id,number,agreement_date,amount_after,vat_rate,vat_amount,work_end_date,note,status)
  values(con.id,trim(body->>'number'),(body->>'agreement_date')::date,
   pto_private.money_arg(body->>'amount_after','цена после допсоглашения'),pto_private.money_arg(body->>'vat_rate','ставка НДС'),
   pto_private.money_arg(body->>'vat_amount','НДС'),nullif(body->>'work_end_date','')::date,trim(coalesce(body->>'note','')),new_status)
  returning id into target;
 elsif op='set_addendum_status' then
  new_status:=body->>'status';
  if not ((adm.status='draft' and new_status in ('signed','cancelled')) or (adm.status='signed' and new_status='cancelled')) then
   raise exception 'Недопустимый переход допсоглашения';
  end if;
  if new_status='cancelled' and length(trim(coalesce(body->>'reason','')))<5 then raise exception 'Укажите причину отмены'; end if;
  update public.pto_contract_addenda set status=new_status where id=adm.id;
  target:=adm.id;
 else
  raise exception 'Неизвестная операция';
 end if;

 insert into public.pto_events(project_id,actor,action,detail)
 values(con.project_id,who,op,body || jsonb_build_object('contract_id',con.id,'addendum_id',target));
 result:=jsonb_build_object('project_id',con.project_id,'contract_id',con.id,'addendum_id',target);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.contract_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.contract_command(uuid,jsonb) to authenticated;

create or replace function pto_private.project_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; prior pto_private.requests; result jsonb; p public.pto_projects;
 v_name text:=trim(coalesce(body->>'name',''));
 v_full text:=trim(coalesce(nullif(trim(body->>'full_name'),''),body->>'name',''));
 v_address text:=trim(coalesce(body->>'address',''));
 v_color text:=nullif(lower(trim(coalesce(body->>'color',''))),'');
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 role_name:=pto_private.my_role();
 if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if role_name not in ('head','admin') then raise exception 'Изменять объект может начальник ПТО' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 if body->>'op'<>'update_project' then raise exception 'Неизвестная команда'; end if;
 select * into p from public.pto_projects where id=(body->>'project_id')::uuid for update;
 if not found then raise exception 'Объект не найден'; end if;
 if length(v_name) not between 1 and 120 then raise exception 'Краткое название должно содержать от 1 до 120 символов'; end if;
 if length(v_full) not between 1 and 500 then raise exception 'Укажите полное наименование объекта'; end if;
 if v_color is not null and v_color !~ '^#[0-9a-f]{6}$' then raise exception 'Неверный цвет объекта'; end if;
 if exists(select 1 from public.pto_projects x where x.id<>p.id and lower(trim(x.name))=lower(v_name)) then
  raise exception 'Объект с таким названием уже есть';
 end if;
 update public.pto_projects set name=v_name,full_name=v_full,address=v_address,color=case when body ? 'color' then v_color else p.color end where id=p.id;
 insert into public.pto_events(project_id,actor,action,detail) values(p.id,who,'update_project',
  jsonb_build_object('before',jsonb_build_object('name',p.name,'full_name',p.full_name,'address',p.address,'color',p.color),
   'after',jsonb_build_object('name',v_name,'full_name',v_full,'address',v_address,'color',case when body ? 'color' then v_color else p.color end)));
 result:=jsonb_build_object('project_id',p.id);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;

create or replace function pto_private.counterparty_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  role_name text;
  op text := body->>'op';
  target uuid;
  result jsonb;
  prior pto_private.requests;
  unp_value text := trim(coalesce(body->>'unp',''));
  short_value text := trim(coalesce(body->>'short_name',''));
  full_value text := trim(coalesce(body->>'full_name',''));
  status_change_value text := coalesce(body->>'status_change_date',body->>'liquidation_date','');
  postal_value text := trim(coalesce(body->>'postal_code',''));
begin
  if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
  role_name := pto_private.my_role();
  if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
  if role_name not in ('head','engineer','admin') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;

  select * into prior from pto_private.requests where id=req;
  if found then
    if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
    return prior.result;
  end if;

  if unp_value !~ '^[0-9]{9}$' then raise exception 'УНП должен содержать 9 цифр'; end if;
  if length(short_value)=0 then raise exception 'Укажите краткое наименование'; end if;
  if length(full_value)=0 then raise exception 'Укажите полное наименование'; end if;
  if postal_value !~ '^([0-9]{6})?$' then raise exception 'Почтовый индекс — 6 цифр'; end if;

  if body ? 'roles' and exists (
    select 1
    from jsonb_array_elements_text(coalesce(body->'roles','[]'::jsonb)) r(value)
    where r.value not in ('customer','general_contractor','subcontractor','supplier','service_provider')
  ) then
    raise exception 'Неизвестная роль контрагента';
  end if;

  if op='create_counterparty' then
    insert into public.pto_counterparties(
      unp,short_name,full_name,address,registration_date,tax_office_code,tax_office_name,
      status_code,status_name,status_change_date,liquidation_info,phone,email,note,source,
      director_name,director_title,authority_basis,okpo,bank_account,bank_name,bank_bic,postal_code
    ) values (
      unp_value,short_value,full_value,trim(coalesce(body->>'address','')),
      nullif(body->>'registration_date','')::date,trim(coalesce(body->>'tax_office_code','')),
      trim(coalesce(body->>'tax_office_name','')),trim(coalesce(body->>'status_code','')),
      trim(coalesce(body->>'status_name','')),nullif(status_change_value,'')::date,
      trim(coalesce(body->>'liquidation_info','')),trim(coalesce(body->>'phone','')),
      trim(coalesce(body->>'email','')),trim(coalesce(body->>'note','')),
      trim(coalesce(nullif(body->>'source',''),'manual')),
      trim(coalesce(body->>'director_name','')),trim(coalesce(body->>'director_title','')),
      trim(coalesce(body->>'authority_basis','')),trim(coalesce(body->>'okpo','')),
      trim(coalesce(body->>'bank_account','')),trim(coalesce(body->>'bank_name','')),
      trim(coalesce(body->>'bank_bic','')),postal_value
    ) returning id into target;
  elsif op='update_counterparty' then
    target := (body->>'counterparty_id')::uuid;
    update public.pto_counterparties set
      unp=unp_value,
      short_name=short_value,
      full_name=full_value,
      address=trim(coalesce(body->>'address','')),
      registration_date=nullif(body->>'registration_date','')::date,
      tax_office_code=trim(coalesce(body->>'tax_office_code','')),
      tax_office_name=trim(coalesce(body->>'tax_office_name','')),
      status_code=trim(coalesce(body->>'status_code','')),
      status_name=trim(coalesce(body->>'status_name','')),
      status_change_date=nullif(status_change_value,'')::date,
      liquidation_info=trim(coalesce(body->>'liquidation_info','')),
      phone=trim(coalesce(body->>'phone','')),
      email=trim(coalesce(body->>'email','')),
      note=trim(coalesce(body->>'note','')),
      source=trim(coalesce(nullif(body->>'source',''),source)),
      director_name=trim(coalesce(body->>'director_name','')),
      director_title=trim(coalesce(body->>'director_title','')),
      authority_basis=trim(coalesce(body->>'authority_basis','')),
      okpo=trim(coalesce(body->>'okpo','')),
      bank_account=trim(coalesce(body->>'bank_account','')),
      bank_name=trim(coalesce(body->>'bank_name','')),
      bank_bic=trim(coalesce(body->>'bank_bic','')),
      postal_code=postal_value,
      updated_at=now()
    where id=target;
    if not found then raise exception 'Контрагент не найден'; end if;
  else
    raise exception 'Неизвестная операция';
  end if;

  if body ? 'roles' then
    delete from public.pto_counterparty_roles where counterparty_id=target;
    insert into public.pto_counterparty_roles(counterparty_id,role)
    select target,r.value
    from jsonb_array_elements_text(coalesce(body->'roles','[]'::jsonb)) r(value)
    on conflict do nothing;
  end if;

  -- Справочник общий для всех объектов: событие без объекта видно начальнику ПТО и администратору.
  insert into public.pto_events(project_id,actor,action,detail)
  values(null,who,op,body || jsonb_build_object('counterparty_id',target));

  result := jsonb_build_object('counterparty_id',target);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='update_project' then pto_private.project_command(request_id,payload)
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
  when payload->>'op' in ('import_contracts','set_contract_checked') then pto_private.contract_import_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
