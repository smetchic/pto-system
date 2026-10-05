-- Откат миграции 20261005215418_normalize_contracts.sql: возвращает хранимые direction и party и прежние функции.
-- Определения функций взяты из миграций 20261004174232, 20261005124044, 20261005185841, 20261005213054, 20261005215002.
-- После выполнения удалить запись версии 20261005215418 из supabase_migrations.schema_migrations.

drop view public.pto_contract_list;
drop view public.pto_register;

alter table public.pto_contracts drop constraint pto_contracts_project_id_number_direction_key;
alter table public.pto_contracts add column direction_stored text;
update public.pto_contracts set direction_stored=direction;
alter table public.pto_contracts drop column direction;
alter table public.pto_contracts rename column direction_stored to direction;
alter table public.pto_contracts alter column direction set not null;
alter table public.pto_contracts add constraint pto_contracts_direction_check check(direction in ('outgoing','incoming'));
alter table public.pto_contracts add constraint pto_contracts_project_id_number_direction_key unique(project_id,number,direction);

alter table public.pto_contracts drop constraint pto_contracts_party_check;
update public.pto_contracts c set party_text=cp.short_name from public.pto_counterparties cp where cp.id=c.counterparty_id and c.party_text is null;
alter table public.pto_contracts rename column party_text to party;
alter table public.pto_contracts alter column party set not null;
alter table public.pto_contracts add constraint pto_contracts_party_check check(length(trim(party)) between 1 and 200);

alter table public.pto_contracts
 alter column smr_amount type numeric, alter column smr_vat_amount type numeric,
 alter column pnr_amount type numeric, alter column pnr_vat_amount type numeric;
alter table public.pto_equipment_ttn
 alter column amount type numeric, alter column vat_amount type numeric;

create view public.pto_register with(security_invoker=true) as
select p.id period_id,p.project_id,p.month,p.status,p.revision,c.id contract_id,c.number,c.party,
 coalesce((select sum(v.amount) from public.pto_documents d join public.pto_versions v on v.id=d.accepted_version
 where d.period_id=p.id and d.contract_id=c.id and d.kind in ('c2a','c2b')),0)::numeric(16,2) total,
 coalesce((select sum(a.amount) from public.pto_allocations a join public.pto_documents d on d.id=a.outgoing_document
 where a.period_id=p.id and d.contract_id=c.id),0)::numeric(16,2) subcontract
from public.pto_periods p join public.pto_contracts c on c.project_id=p.project_id and c.direction='outgoing'
where exists(select 1 from public.pto_documents d where d.period_id=p.id and d.contract_id=c.id);
revoke all on public.pto_register from anon, authenticated;
grant select on public.pto_register to authenticated;

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
  when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
  when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
  when payload->>'op' in ('create_process','transition_process') then pto_private.process_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

drop function pto_private.contract_command(uuid,jsonb);
drop function pto_private.money_arg(text,text);

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
    project_id,number,party,direction,counterparty_id,contract_date,subject,our_role,counterparty_role
  ) values(
    project,trim(body->>'number'),cp_name,direction_value,cp,
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

create or replace function pto_private.counterparty_command(req uuid, body jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
    update public.pto_contracts set party=short_value where counterparty_id=target;
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

  result := jsonb_build_object('counterparty_id',target);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $function$;

revoke all on function pto_private.create_contract(uuid,jsonb), pto_private.counterparty_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.create_contract(uuid,jsonb), pto_private.counterparty_command(uuid,jsonb) to authenticated;

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
 select c.id,c.number,coalesce(nullif(trim(cp.short_name),''),c.party) base,coalesce(c.counterparty_id::text,c.party) party_key
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
