-- Шаг 4 плана: нормализация договоров (бриф, раздел 1: значение вводится один раз, остальное вычисляется).
-- * direction вычисляется из роли контрагента (generated column), а не хранится отдельно;
-- * название контрагента берётся из справочника; party_text хранится только у договора без контрагента;
-- * текущая стоимость и срок договора вычисляются по подписанным допсоглашениям (представление pto_contract_list);
-- * условия договора и допсоглашения вводятся командами с проверкой прав и записью в журнал;
-- * суммы СМР/ПНР и ТТН хранятся в рублях и копейках (numeric(18,2)).
-- Откат: supabase/rollback/20261005220232_normalize_contracts.down.sql

-- 1. Точность денежных полей, добавленных без масштаба.
alter table public.pto_contracts
 alter column smr_amount type numeric(18,2), alter column smr_vat_amount type numeric(18,2),
 alter column pnr_amount type numeric(18,2), alter column pnr_vat_amount type numeric(18,2);
alter table public.pto_equipment_ttn
 alter column amount type numeric(18,2), alter column vat_amount type numeric(18,2);

-- 2. Название контрагента не копируется в договор.
drop view public.pto_register;
alter table public.pto_contracts rename column party to party_text;
alter table public.pto_contracts drop constraint pto_contracts_party_check;
alter table public.pto_contracts alter column party_text drop not null;
update public.pto_contracts set party_text=null where counterparty_id is not null;
alter table public.pto_contracts add constraint pto_contracts_party_check
 check (counterparty_id is not null or length(trim(coalesce(party_text,''))) between 1 and 200);

-- 3. Направление выводится из роли контрагента.
alter table public.pto_contracts drop column direction;
alter table public.pto_contracts add column direction text generated always as
 (case when counterparty_role in ('customer','general_contractor') then 'outgoing' else 'incoming' end) stored;
alter table public.pto_contracts add constraint pto_contracts_project_id_number_direction_key unique(project_id,number,direction);

-- 4. Представления. Реестр — прежний расчёт, имя контрагента из справочника.
create view public.pto_register with(security_invoker=true) as
select p.id period_id,p.project_id,p.month,p.status,p.revision,c.id contract_id,c.number,coalesce(cp.short_name,c.party_text) party,
 coalesce((select sum(v.amount) from public.pto_documents d join public.pto_versions v on v.id=d.accepted_version
 where d.period_id=p.id and d.contract_id=c.id and d.kind in ('c2a','c2b')),0)::numeric(16,2) total,
 coalesce((select sum(a.amount) from public.pto_allocations a join public.pto_documents d on d.id=a.outgoing_document
 where a.period_id=p.id and d.contract_id=c.id),0)::numeric(16,2) subcontract
from public.pto_periods p
join public.pto_contracts c on c.project_id=p.project_id and c.direction='outgoing'
left join public.pto_counterparties cp on cp.id=c.counterparty_id
where exists(select 1 from public.pto_documents d where d.period_id=p.id and d.contract_id=c.id);

-- Договор с вычисленными полями: имя контрагента, текущая стоимость и срок по последнему подписанному допсоглашению.
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

revoke all on public.pto_register, public.pto_contract_list from anon, authenticated;
grant select on public.pto_register, public.pto_contract_list to authenticated;

-- 5. Создание договора: имя контрагента не копируется, направление не передаётся.
create or replace function pto_private.create_contract(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  role_name text;
  project uuid := (body->>'project_id')::uuid;
  cp uuid;
  cp_name text;
  our_role_value text;
  cp_role_value text;
  direction_value text;
  result jsonb;
  prior pto_private.requests;
begin
  if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
  role_name := pto_private.my_role();
  if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
  if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  if not coalesce(pto_private.can_access(project),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;

  select * into prior from pto_private.requests where id=req;
  if found then
    if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
    return prior.result;
  end if;

  if nullif(body->>'counterparty_id','') is not null then
    cp := (body->>'counterparty_id')::uuid;
    select short_name into cp_name from public.pto_counterparties where id=cp;
    if cp_name is null then raise exception 'Контрагент не найден'; end if;
  else
    cp_name := trim(coalesce(body->>'party',''));
    if length(cp_name)=0 then raise exception 'Выберите контрагента'; end if;
  end if;

  our_role_value := coalesce(nullif(body->>'our_role',''),case when body->>'direction'='incoming' then 'customer' else 'contractor' end);
  cp_role_value := coalesce(nullif(body->>'counterparty_role',''),case when body->>'direction'='incoming' then 'subcontractor' else 'customer' end);

  if not (
    (our_role_value='contractor' and cp_role_value='customer') or
    (our_role_value='subcontractor' and cp_role_value in ('general_contractor','customer')) or
    (our_role_value='customer' and cp_role_value='subcontractor') or
    (our_role_value='buyer' and cp_role_value='supplier') or
    (our_role_value='service_customer' and cp_role_value='service_provider')
  ) then
    raise exception 'Несовместимые роли сторон договора';
  end if;

  direction_value := case when cp_role_value in ('customer','general_contractor') then 'outgoing' else 'incoming' end;

  insert into public.pto_contracts(
    project_id,number,party_text,counterparty_id,contract_date,subject,our_role,counterparty_role
  ) values(
    project,trim(body->>'number'),case when cp is null then cp_name end,cp,
    nullif(body->>'contract_date','')::date,trim(coalesce(body->>'subject','')),
    our_role_value,cp_role_value
  );

  if cp is not null then
    insert into public.pto_counterparty_roles(counterparty_id,role)
    values(cp,cp_role_value)
    on conflict do nothing;

    if cp_role_value in ('customer','general_contractor','subcontractor') then
      insert into public.pto_project_participants(project_id,counterparty_id,role)
      values(project,cp,cp_role_value)
      on conflict(project_id,counterparty_id,role) do nothing;
    end if;
  end if;

  insert into public.pto_events(project_id,actor,action,detail)
  values(project,who,'create_contract',body || jsonb_build_object('direction',direction_value));

  result := jsonb_build_object('project_id',project,'counterparty_id',cp,'our_role',our_role_value,'counterparty_role',cp_role_value);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;

-- 6. Контрагент: без синхронизации копий имени в договорах; изменения пишутся в журнал.
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
      director_name,director_title,authority_basis,okpo,bank_account,bank_name,bank_bic
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
      trim(coalesce(body->>'bank_bic',''))
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

-- 7. Сумма из формы: рубли и копейки, без отрицательных и NaN.
create or replace function pto_private.money_arg(v text, label text) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if v is null or trim(v)='' then return null; end if;
 begin
  n:=replace(replace(trim(v),' ',''),',','.')::numeric;
 exception when others then
  raise exception 'Некорректная сумма: %',label;
 end;
 if n='NaN'::numeric or n<0 then raise exception 'Некорректная сумма: %',label; end if;
 if n<>round(n,2) then raise exception 'Сумма «%» указывается в рублях и копейках',label; end if;
 return n;
end $$;

-- 8. Условия договора и допсоглашения.
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

revoke all on function pto_private.money_arg(text,text), pto_private.contract_command(uuid,jsonb),
 pto_private.create_contract(uuid,jsonb), pto_private.counterparty_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.contract_command(uuid,jsonb), pto_private.create_contract(uuid,jsonb),
 pto_private.counterparty_command(uuid,jsonb) to authenticated;

-- 9. Реестр: имя колонки субподряда из справочника, при его отсутствии — party_text.
create or replace function public.pto_register_matrix(p_month date) returns jsonb
language sql stable set search_path='' as $$
with reg as (
 select r.period_id,r.project_id,r.contract_id,r.number,r.total::numeric(18,2) total,r.subcontract::numeric(18,2) subcontract
 from public.pto_register r
 where r.month=p_month and (r.total<>0 or r.subcontract<>0)
),
cells as (
 select a.period_id,o.contract_id out_contract,i.contract_id in_contract,sum(a.amount)::numeric(18,2) amount
 from public.pto_allocations a
 join public.pto_documents o on o.id=a.outgoing_document
 join public.pto_documents i on i.id=a.incoming_document
 join reg on reg.period_id=a.period_id and reg.contract_id=o.contract_id
 group by 1,2,3
 having sum(a.amount)<>0
),
cols as (
 select c.id,c.number,coalesce(nullif(trim(cp.short_name),''),c.party_text) base,coalesce(c.counterparty_id::text,c.party_text) party_key
 from public.pto_contracts c
 left join public.pto_counterparties cp on cp.id=c.counterparty_id
 where c.id in (select in_contract from cells)
),
labeled as (
 -- Один контрагент с несколькими договорами за месяц: к подписи добавляется номер договора.
 select id,case when count(*) over(partition by party_key)>1 then base||' · №'||number else base end label from cols
),
rows_c as (
 select reg.project_id,p.name project,reg.contract_id,reg.number,reg.total,reg.subcontract,(reg.total-reg.subcontract)::numeric(18,2) own,
  coalesce((select jsonb_object_agg(c.in_contract,c.amount::text) from cells c where c.period_id=reg.period_id and c.out_contract=reg.contract_id),'{}'::jsonb) cells
 from reg join public.pto_projects p on p.id=reg.project_id
),
rows_p as (
 select rc.project_id,rc.project,sum(rc.total)::numeric(18,2) total,sum(rc.subcontract)::numeric(18,2) subcontract,sum(rc.own)::numeric(18,2) own,
  coalesce((select jsonb_object_agg(t.in_contract,t.s::text) from (
   select c.in_contract,sum(c.amount)::numeric(18,2) s from cells c join reg r on r.period_id=c.period_id and r.contract_id=c.out_contract
   where r.project_id=rc.project_id group by c.in_contract) t),'{}'::jsonb) cells
 from rows_c rc
 group by rc.project_id,rc.project
 having count(*)>1
)
select jsonb_build_object(
 'month',p_month,
 'columns',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,
   'total',(select sum(c.amount) from cells c where c.in_contract=l.id)::numeric(18,2)::text) order by l.label,l.id) from labeled l),'[]'::jsonb),
 'rows',coalesce((select jsonb_agg(x.j order by x.project,x.project_id,x.ord,x.number) from (
   select project,project_id,0 ord,number,jsonb_build_object('kind','contract','project_id',project_id,'project',project,'contract_id',contract_id,'number',number,
    'total',total::text,'own',own::text,'subcontract',subcontract::text,'cells',cells) j from rows_c
   union all
   select project,project_id,1,'',jsonb_build_object('kind','project','project_id',project_id,'project',project,
    'total',total::text,'own',own::text,'subcontract',subcontract::text,'cells',cells) from rows_p) x),'[]'::jsonb),
 'total',jsonb_build_object(
  'total',(select coalesce(sum(total),0) from reg)::numeric(18,2)::text,
  'subcontract',(select coalesce(sum(subcontract),0) from reg)::numeric(18,2)::text,
  'own',(select coalesce(sum(total-subcontract),0) from reg)::numeric(18,2)::text,
  'cells',coalesce((select jsonb_object_agg(t.in_contract,t.s::text) from (select in_contract,sum(amount)::numeric(18,2) s from cells group by 1) t),'{}'::jsonb))
);
$$;
revoke all on function public.pto_register_matrix(date) from public, anon;
grant execute on function public.pto_register_matrix(date) to authenticated;

-- 10. Диспетчер команд.
create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
  when payload->>'op' in ('update_contract','create_addendum','set_addendum_status') then pto_private.contract_command(request_id,payload)
  when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
  when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
  when payload->>'op' in ('create_process','transition_process') then pto_private.process_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
