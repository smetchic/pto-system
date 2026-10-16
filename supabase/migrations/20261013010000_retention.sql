-- Гарантийные удержания (решение пользователя 12.10.2026, «все»).
-- 1. Договор: процент удержания (пусто — удержания нет), база (по закону СМР без НДС; у части заказчиков — с НДС),
--    график возврата (по закону 50 % через 1 год после ввода объекта, остаток через 2 года). Для наших договоров и субподряда.
-- 2. Объект: дата ввода в эксплуатацию — от неё считаются сроки возврата.
-- 3. Справка С-3а: удержание за период = база × процент; можно ввести вручную (тогда экран предупреждает о расхождении
--    с расчётом, но не блокирует). К оплате = СМР + оборудование − зачёт авансов − удержание.
--    Субподрядчик: удержание по его актам за месяц (база × процент договора субподряда) или вручную из его С-3а.
-- 4. Карточка договора: удержано всего и сроки возврата (pto_retention_summary).
-- Возврат удержания документом через «Подписание» — следующая миграция.
-- Ручные удержания хранятся в журнале только на добавление: действует последняя запись, пустая сумма — снова расчёт.
-- Откат: supabase/rollback/20261013010000_retention.down.sql

alter table public.pto_contracts
 add column if not exists retention_percent numeric(5,2) check (retention_percent is null or retention_percent between 0 and 100),
 add column if not exists retention_base text not null default 'net' check (retention_base in ('net','gross')),
 add column if not exists retention_first_share numeric(5,2) not null default 50 check (retention_first_share between 0 and 100),
 add column if not exists retention_first_years smallint not null default 1 check (retention_first_years between 0 and 10),
 add column if not exists retention_final_years smallint not null default 2 check (retention_final_years between 0 and 10);
comment on column public.pto_contracts.retention_percent is 'Гарантийное удержание, % (пусто — удержания по договору нет).';
comment on column public.pto_contracts.retention_base is 'База удержания: net — СМР без НДС (по закону), gross — СМР с НДС.';
comment on column public.pto_contracts.retention_first_share is 'Доля удержания, возвращаемая первой, %; остаток — во второй срок.';
comment on column public.pto_contracts.retention_first_years is 'Первый возврат: лет после ввода объекта.';
comment on column public.pto_contracts.retention_final_years is 'Окончательный возврат: лет после ввода объекта.';

alter table public.pto_projects add column if not exists commissioned_on date;
comment on column public.pto_projects.commissioned_on is 'Дата ввода объекта в эксплуатацию: от неё считаются сроки возврата удержаний.';

-- Ручное удержание: у нашей справки С-3а (document_id) или у субподрядчика за месяц (period_id + contract_id).
create table if not exists public.pto_retention_marks (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 period_id uuid not null references public.pto_periods(id) on delete restrict,
 contract_id uuid not null references public.pto_contracts(id) on delete restrict,
 document_id uuid references public.pto_documents(id) on delete restrict,
 amount numeric(18,2) check (amount>=0),
 note text not null default '',
 created_by uuid not null references public.pto_profiles(id),
 created_at timestamptz not null default now()
);
comment on table public.pto_retention_marks is 'Удержание, введённое вручную: действует последняя запись по справке (или по субподрядчику за месяц); пустая сумма — снова расчёт.';
create index if not exists pto_retention_marks_current_idx on public.pto_retention_marks(period_id,contract_id,created_at desc);
create index if not exists pto_retention_marks_document_idx on public.pto_retention_marks(document_id);
create index if not exists pto_retention_marks_project_idx on public.pto_retention_marks(project_id);
create index if not exists pto_retention_marks_contract_idx on public.pto_retention_marks(contract_id);
create index if not exists pto_retention_marks_created_by_idx on public.pto_retention_marks(created_by);
alter table public.pto_retention_marks enable row level security;
revoke all on public.pto_retention_marks from anon, authenticated;
grant select on public.pto_retention_marks to authenticated;
drop policy if exists scoped_read on public.pto_retention_marks;
create policy scoped_read on public.pto_retention_marks for select to authenticated using (coalesce(pto_private.can_read(project_id),false));
drop trigger if exists pto_retention_marks_append_only on public.pto_retention_marks;
create trigger pto_retention_marks_append_only before update or delete on public.pto_retention_marks for each row execute function pto_private.forbid_change();
drop trigger if exists pto_retention_marks_no_truncate on public.pto_retention_marks;
create trigger pto_retention_marks_no_truncate before truncate on public.pto_retention_marks for each statement execute function pto_private.forbid_change();

-- Удаление ошибочного документа (начальник ПТО, delete_wrong_document) убирает и его ручные удержания.
create or replace function pto_private.retention_marks_document_deleted()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.pto_retention_marks where document_id=old.id;
 return old;
end $$;
revoke all on function pto_private.retention_marks_document_deleted() from public, anon, authenticated;
drop trigger if exists pto_documents_retention_marks on public.pto_documents;
create trigger pto_documents_retention_marks before delete on public.pto_documents
for each row execute function pto_private.retention_marks_document_deleted();

drop view if exists public.pto_retention_summary;
drop view if exists public.pto_retention;
drop view if exists public.pto_c3a_report;
drop view if exists public.pto_retention_marks_current;
create view public.pto_retention_marks_current with(security_invoker=true) as
 select distinct on (period_id,contract_id,document_id) * from public.pto_retention_marks
 order by period_id,contract_id,document_id,created_at desc,id desc;
revoke all on public.pto_retention_marks_current from anon, authenticated;
grant select on public.pto_retention_marks_current to authenticated;

-- Удержание по месяцам: наша сторона — каждая справка С-3а (текущая версия) по договору с заказчиком,
-- субподряд — акты договора субподряда за месяц (НДС из версии, иначе по ставке договора).
create view public.pto_retention with(security_invoker=true) as
with base as (
 select d.project_id,d.period_id,p.month,d.contract_id,d.id document_id,'our'::text side,
  v.amount::numeric(18,2) smr,coalesce(v.smr_vat,0)::numeric(18,2) smr_vat
 from public.pto_documents d
 join public.pto_versions v on v.id=d.current_version
 join public.pto_periods p on p.id=d.period_id
 join public.pto_contracts c on c.id=d.contract_id
 where d.kind='c3a' and c.direction='outgoing'
 union all
 select d.project_id,d.period_id,p.month,d.contract_id,null::uuid,'sub'::text,
  sum(v.amount)::numeric(18,2),
  sum(coalesce(v.smr_vat,round(v.amount*coalesce(c.vat_rate,20)/(100+coalesce(c.vat_rate,20)),2)))::numeric(18,2)
 from public.pto_documents d
 join public.pto_versions v on v.id=d.current_version
 join public.pto_periods p on p.id=d.period_id
 join public.pto_contracts c on c.id=d.contract_id
 where d.kind in ('c2a','c2b') and c.direction='incoming'
 group by d.project_id,d.period_id,p.month,d.contract_id
)
select b.*,c.retention_percent percent,c.retention_base base,
 (b.smr-case when c.retention_base='net' then b.smr_vat else 0 end)::numeric(18,2) base_amount,
 rc.calc,m.amount manual,coalesce(m.amount,rc.calc)::numeric(18,2) amount
from base b
join public.pto_contracts c on c.id=b.contract_id
cross join lateral (select case when c.retention_percent is null then 0
  else round((b.smr-case when c.retention_base='net' then b.smr_vat else 0 end)*c.retention_percent/100,2) end::numeric(18,2) calc) rc
left join public.pto_retention_marks_current m on m.period_id=b.period_id and m.contract_id=b.contract_id and m.document_id is not distinct from b.document_id
where c.retention_percent is not null or m.amount is not null;
revoke all on public.pto_retention from anon, authenticated;
grant select on public.pto_retention to authenticated;

-- Итог по договору: удержано всего (по текущим справкам и актам) и сроки возврата от даты ввода объекта.
create view public.pto_retention_summary with(security_invoker=true) as
select c.id contract_id,c.project_id,c.direction,c.retention_percent percent,c.retention_base base,
 c.retention_first_share first_share,c.retention_first_years first_years,c.retention_final_years final_years,
 coalesce(r.retained,0)::numeric(18,2) retained,
 pr.commissioned_on,
 (pr.commissioned_on+make_interval(years=>c.retention_first_years))::date first_due,
 (pr.commissioned_on+make_interval(years=>c.retention_final_years))::date final_due,
 round(coalesce(r.retained,0)*c.retention_first_share/100,2)::numeric(18,2) first_amount,
 (coalesce(r.retained,0)-round(coalesce(r.retained,0)*c.retention_first_share/100,2))::numeric(18,2) final_amount
from public.pto_contracts c
join public.pto_projects pr on pr.id=c.project_id
left join (select contract_id,sum(amount) retained from public.pto_retention group by contract_id) r on r.contract_id=c.id
where c.retention_percent is not null or r.retained is not null;
revoke all on public.pto_retention_summary from anon, authenticated;
grant select on public.pto_retention_summary to authenticated;

-- Команды: процент и график по договору, дата ввода объекта, ручное удержание.
create or replace function pto_private.retention_command(req uuid,body jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op'; prior pto_private.requests; result jsonb;
 con public.pto_contracts; prj public.pto_projects; per public.pto_periods; doc public.pto_documents;
 cur public.pto_retention_marks; v_pct numeric; v_base text; v_share numeric; v_y1 int; v_y2 int; v_amount numeric; v_date date; target uuid;
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

 if op='set_retention' then
  select * into con from public.pto_contracts where id=nullif(body->>'contract_id','')::uuid for update;
  if not found then raise exception 'Договор не найден'; end if;
  if not coalesce(pto_private.can_access(con.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  v_pct:=case when body ? 'percent' then pto_private.money_arg(body->>'percent','процент удержания') else con.retention_percent end;
  if v_pct is not null and (v_pct<0 or v_pct>100) then raise exception 'Процент удержания — от 0 до 100'; end if;
  v_base:=coalesce(nullif(body->>'base',''),con.retention_base);
  if v_base not in ('net','gross') then raise exception 'База удержания: без НДС или с НДС'; end if;
  v_share:=coalesce(pto_private.money_arg(body->>'first_share','доля первого возврата'),con.retention_first_share);
  if v_share<0 or v_share>100 then raise exception 'Доля первого возврата — от 0 до 100 %%'; end if;
  v_y1:=coalesce(nullif(body->>'first_years','')::int,con.retention_first_years);
  v_y2:=coalesce(nullif(body->>'final_years','')::int,con.retention_final_years);
  if v_y1<0 or v_y2>10 or v_y2<v_y1 then raise exception 'Сроки возврата: от 0 до 10 лет, окончательный не раньше первого'; end if;
  update public.pto_contracts set retention_percent=v_pct,retention_base=v_base,retention_first_share=v_share,
   retention_first_years=v_y1,retention_final_years=v_y2 where id=con.id;
  insert into public.pto_events(project_id,actor,action,detail) values(con.project_id,who,op,body||jsonb_build_object('before',
   jsonb_build_object('percent',con.retention_percent,'base',con.retention_base,'first_share',con.retention_first_share,
    'first_years',con.retention_first_years,'final_years',con.retention_final_years)));
  result:=jsonb_build_object('project_id',con.project_id,'contract_id',con.id);

 elsif op='set_commissioning' then
  select * into prj from public.pto_projects where id=nullif(body->>'project_id','')::uuid for update;
  if not found then raise exception 'Объект не найден'; end if;
  if not coalesce(pto_private.can_access(prj.id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  v_date:=nullif(body->>'commissioned_on','')::date;
  update public.pto_projects set commissioned_on=v_date where id=prj.id;
  insert into public.pto_events(project_id,actor,action,detail) values(prj.id,who,op,body||jsonb_build_object('was',prj.commissioned_on));
  result:=jsonb_build_object('project_id',prj.id);

 elsif op='set_retention_amount' then
  if nullif(body->>'document_id','') is not null then
   select * into doc from public.pto_documents where id=(body->>'document_id')::uuid;
   if not found or doc.kind<>'c3a' then raise exception 'Удержание вводится в справке С-3а'; end if;
   select * into per from public.pto_periods where id=doc.period_id for update;
   select * into con from public.pto_contracts where id=doc.contract_id;
  else
   select * into per from public.pto_periods where id=nullif(body->>'period_id','')::uuid for update;
   if not found then raise exception 'Период не найден'; end if;
   select * into con from public.pto_contracts where id=nullif(body->>'contract_id','')::uuid and project_id=per.project_id;
   if not found or con.direction<>'incoming' then raise exception 'Нужен договор субподряда этого объекта'; end if;
  end if;
  if not coalesce(pto_private.can_access(per.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  if per.status<>'open' then raise exception 'Период закрыт'; end if;
  v_amount:=pto_private.money_arg(body->>'amount','удержание');
  select * into cur from public.pto_retention_marks m where m.period_id=per.id and m.contract_id=con.id and m.document_id is not distinct from doc.id
   order by m.created_at desc,m.id desc limit 1;
  insert into public.pto_retention_marks(project_id,period_id,contract_id,document_id,amount,note,created_by)
  values(per.project_id,per.id,con.id,doc.id,v_amount,trim(coalesce(body->>'note','')),who) returning id into target;
  -- Изменение суммы возвращает проверенный месяц на повторную проверку.
  if v_amount is distinct from cur.amount then
   update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id;
  end if;
  insert into public.pto_events(project_id,period_id,document_id,actor,action,detail) values(per.project_id,per.id,doc.id,who,op,body||jsonb_build_object('was',cur.amount));
  result:=jsonb_build_object('project_id',per.project_id,'period_id',per.id,'id',target);
 else
  raise exception 'Неизвестная операция';
 end if;
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.retention_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.retention_command(uuid,jsonb) to authenticated;

-- Справка С-3а: удержание за период (расчёт по проценту договора или ручное), к оплате за вычетом удержания.
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
  coalesce(v.advance_current_offset,0)::numeric(18,2) current_offset,
  rc.calc retention_calc,
  rm.amount retention_manual,
  coalesce(rm.amount,rc.calc)::numeric(18,2) retention
 from public.pto_versions v
 join public.pto_documents d on d.id=v.document_id
 join public.pto_periods p on p.id=d.period_id
 join public.pto_contracts c on c.id=d.contract_id
 cross join lateral (select case when c.retention_percent is null then 0
   else round((v.amount-case when c.retention_base='net' then coalesce(v.smr_vat,0) else 0 end)*c.retention_percent/100,2) end::numeric(18,2) calc) rc
 left join public.pto_retention_marks_current rm on rm.document_id=d.id
 where d.kind='c3a'
),
-- Накопление: прошлый месяц входит с шага «Проверено» (текущая версия), до него — только принятая бухгалтерией версия.
acc as (
 select v.* from v join public.pto_documents d on d.id=v.document_id
 where v.version_id=case when exists(select 1 from public.pto_workflow_documents wd join public.pto_workflows w on w.id=wd.workflow_id
   where wd.document_id=d.id and w.step_code in ('signed','accepted','closed')) then d.current_version else d.accepted_version end
)
select v.*,
 (v.smr+v.equipment-v.target_offset-v.current_offset-v.retention)::numeric(18,2) to_pay,
 (y.smr+v.smr)::numeric(18,2) ytd_smr,
 (y.smr_vat+v.smr_vat)::numeric(18,2) ytd_smr_vat,
 (y.equipment+v.equipment)::numeric(18,2) ytd_equipment,
 (y.equipment_vat+v.equipment_vat)::numeric(18,2) ytd_equipment_vat,
 (y.target_offset+v.target_offset)::numeric(18,2) ytd_target_offset,
 (y.current_offset+v.current_offset)::numeric(18,2) ytd_current_offset,
 (y.retention+v.retention)::numeric(18,2) ytd_retention,
 (y.smr+v.smr+y.equipment+v.equipment-y.target_offset-v.target_offset-y.current_offset-v.current_offset-y.retention-v.retention)::numeric(18,2) ytd_to_pay,
 (s.smr+v.smr)::numeric(18,2) total_smr,
 (s.smr_vat+v.smr_vat)::numeric(18,2) total_smr_vat,
 (s.equipment+v.equipment)::numeric(18,2) total_equipment,
 (s.equipment_vat+v.equipment_vat)::numeric(18,2) total_equipment_vat,
 (s.target_offset+v.target_offset)::numeric(18,2) total_target_offset,
 (s.current_offset+v.current_offset)::numeric(18,2) total_current_offset,
 (s.retention+v.retention)::numeric(18,2) total_retention,
 (s.smr+v.smr+s.equipment+v.equipment-s.target_offset-v.target_offset-s.current_offset-v.current_offset-s.retention-v.retention)::numeric(18,2) total_to_pay,
 pp.part_id
from v
cross join lateral (select (select m.part_id from public.pto_document_marks_current m where m.document_id=v.document_id) part_id) pp
cross join lateral (select coalesce(sum(a.smr),0) smr,coalesce(sum(a.smr_vat),0) smr_vat,coalesce(sum(a.equipment),0) equipment,coalesce(sum(a.equipment_vat),0) equipment_vat,coalesce(sum(a.target_offset),0) target_offset,coalesce(sum(a.current_offset),0) current_offset,coalesce(sum(a.retention),0) retention from acc a where a.contract_id=v.contract_id and a.month<v.month and a.month>=date_trunc('year',v.month)::date
  and (select m.part_id from public.pto_document_marks_current m where m.document_id=a.document_id) is not distinct from pp.part_id) y
cross join lateral (select coalesce(sum(a.smr),0) smr,coalesce(sum(a.smr_vat),0) smr_vat,coalesce(sum(a.equipment),0) equipment,coalesce(sum(a.equipment_vat),0) equipment_vat,coalesce(sum(a.target_offset),0) target_offset,coalesce(sum(a.current_offset),0) current_offset,coalesce(sum(a.retention),0) retention from acc a where a.contract_id=v.contract_id and a.month<v.month
  and (select m.part_id from public.pto_document_marks_current m where m.document_id=a.document_id) is not distinct from pp.part_id) s;

revoke all on public.pto_c3a_report from anon, authenticated;
grant select on public.pto_c3a_report to authenticated;

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
  when payload->>'op' in ('set_retention','set_commissioning','set_retention_amount') then pto_private.retention_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end
$$;

revoke all on function public.pto_command(uuid,jsonb) from public,anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
