-- Вкладка «Месяц» (docs/month.md), решения пользователя от 10.10.2026:
-- 1. «Отправлено заказчику» с датой — событие внутри шага «На проверке»: дата и причина повторной отправки в отметках месяца.
-- 2. Части договора (ССР) со своей ставкой НДС: жилая часть, встроенные помещения, часть без НДС по льготе.
--    Акты С-2 и справка С-3а оформляются по частям, но идут одним комплектом с общим статусом (бриф, раздел 2).
--    Часть указывается в отметке документа; реестр показывает строку на каждую часть и «Итого по договору».
-- Откат: supabase/rollback/20261010235000_sent_and_contract_parts.down.sql

-- 1. Отправка заказчику.
alter table public.pto_month_marks add column sent_on date, add column sent_note text not null default '';
create or replace view public.pto_month_marks_current with(security_invoker=true) as
select distinct on (m.period_id) m.*,(select min(x.sent_on) from public.pto_month_marks x where x.period_id=m.period_id) first_sent_on
from public.pto_month_marks m order by m.period_id,m.created_at desc,m.id desc;

-- 2. Части договора. Правка — командой set_contract_part (журнал в pto_events); удалять нельзя, только снять «действует».
create table public.pto_contract_parts (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 contract_id uuid not null references public.pto_contracts(id) on delete restrict,
 name text not null check (length(trim(name)) between 1 and 200),
 vat_rate numeric(5,2) check (vat_rate>=0 and vat_rate<=100),
 amount numeric(18,2) check (amount>=0),
 ordinal integer not null default 0,
 active boolean not null default true,
 created_by uuid not null references public.pto_profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
comment on table public.pto_contract_parts is 'Часть договора (ССР) со своей ставкой НДС: 0 — без НДС по льготе. Документы привязываются отметкой (pto_document_marks.part_id).';
create index pto_contract_parts_contract_idx on public.pto_contract_parts(contract_id,ordinal);
create index pto_contract_parts_project_idx on public.pto_contract_parts(project_id);
create index pto_contract_parts_created_by_idx on public.pto_contract_parts(created_by);
alter table public.pto_contract_parts enable row level security;
revoke all on public.pto_contract_parts from anon, authenticated;
grant select on public.pto_contract_parts to authenticated;
create policy scoped_read on public.pto_contract_parts for select to authenticated using (coalesce(pto_private.can_read(project_id),false));
create trigger pto_contract_parts_no_delete before delete on public.pto_contract_parts for each row execute function pto_private.forbid_change();
create trigger pto_contract_parts_no_truncate before truncate on public.pto_contract_parts for each statement execute function pto_private.forbid_change();

alter table public.pto_document_marks add column part_id uuid references public.pto_contract_parts(id) on delete restrict;
create index pto_document_marks_part_idx on public.pto_document_marks(part_id);
create or replace view public.pto_document_marks_current with(security_invoker=true) as
select distinct on (document_id) * from public.pto_document_marks order by document_id,created_at desc,id desc;

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

-- 3. Команды отметок месяца: + дата отправки, + часть договора у документа.
create or replace function pto_private.month_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; per public.pto_periods; con public.pto_contracts; doc public.pto_documents; fil public.pto_files;
 cur_s public.pto_sub_month; cur_m public.pto_month_marks; cur_d public.pto_document_marks;
 op text:=body->>'op'; target uuid; result jsonb; prior pto_private.requests; money_changed boolean:=false;
 v_plan numeric; v_on numeric; v_eq numeric; v_to numeric; v_co numeric; v_mat numeric;
 part public.pto_contract_parts; v_sent date; v_part uuid;
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

 -- Период: прямо из команды или через документ / файл.
 if op in ('set_sub_month','set_month_marks') then
  select * into per from public.pto_periods where id=(body->>'period_id')::uuid for update;
 elsif op='set_document_mark' then
  select * into doc from public.pto_documents where id=(body->>'document_id')::uuid;
  if not found then raise exception 'Документ не найден'; end if;
  select * into per from public.pto_periods where id=doc.period_id for update;
 elsif op='check_file' then
  select * into fil from public.pto_files where id=(body->>'file_id')::uuid;
  if not found then raise exception 'Файл не найден'; end if;
  select d.* into doc from public.pto_versions v join public.pto_documents d on d.id=v.document_id where v.id=fil.version_id;
  select * into per from public.pto_periods where id=doc.period_id for update;
 else
  raise exception 'Неизвестная операция';
 end if;
 if per.id is null then raise exception 'Период не найден'; end if;
 if not coalesce(pto_private.can_access(per.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 if per.status<>'open' then raise exception 'Период закрыт'; end if;

 if op='set_sub_month' then
  select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid and project_id=per.project_id;
  if not found or con.direction<>'incoming' then raise exception 'Нужен договор субподряда этого объекта'; end if;
  select * into cur_s from public.pto_sub_month where period_id=per.id and contract_id=con.id order by created_at desc,id desc limit 1;
  if body ? 'tn_status' and body->>'tn_status' is not null and body->>'tn_status' not in ('tn','oral','ok') then raise exception 'Неизвестный статус технадзора'; end if;
  v_plan:=case when body ? 'plan' then pto_private.money_arg(body->>'plan','план') else cur_s.plan end;
  v_on:=case when body ? 'on_customer' then pto_private.money_arg(body->>'on_customer','сумма «на заказчика»') else cur_s.on_customer end;
  v_eq:=case when body ? 'equipment' then pto_private.money_arg(body->>'equipment','оборудование') else cur_s.equipment end;
  v_to:=case when body ? 'target_offset' then pto_private.money_arg(body->>'target_offset','зачёт целевого аванса') else cur_s.target_offset end;
  v_co:=case when body ? 'current_offset' then pto_private.money_arg(body->>'current_offset','зачёт текущего аванса') else cur_s.current_offset end;
  money_changed:=v_on is distinct from cur_s.on_customer or v_eq is distinct from cur_s.equipment or v_to is distinct from cur_s.target_offset or v_co is distinct from cur_s.current_offset;
  insert into public.pto_sub_month(project_id,period_id,contract_id,expected,plan,tn_status,on_customer,equipment,target_offset,current_offset,note,created_by)
  values(per.project_id,per.id,con.id,
   case when body ? 'expected' then coalesce((body->>'expected')::boolean,false) else coalesce(cur_s.expected,true) end,
   v_plan,case when body ? 'tn_status' then body->>'tn_status' else cur_s.tn_status end,v_on,v_eq,v_to,v_co,
   trim(coalesce(body->>'note','')),who) returning id into target;
 elsif op='set_month_marks' then
  select * into cur_m from public.pto_month_marks where period_id=per.id order by created_at desc,id desc limit 1;
  -- «Отправлено заказчику»: дата отправки; повторная отправка с другой датой — только с причиной.
  v_sent:=case when body ? 'sent_on' then nullif(body->>'sent_on','')::date else cur_m.sent_on end;
  if body ? 'sent_on' and v_sent is not null and cur_m.sent_on is not null and v_sent<>cur_m.sent_on and length(trim(coalesce(body->>'sent_note','')))=0 then
   raise exception 'Укажите причину повторной отправки';
  end if;
  insert into public.pto_month_marks(project_id,period_id,equipment_expected,materials_expected,sent_on,sent_note,created_by)
  values(per.project_id,per.id,
   case when body ? 'equipment_expected' then coalesce((body->>'equipment_expected')::boolean,false) else coalesce(cur_m.equipment_expected,false) end,
   case when body ? 'materials_expected' then coalesce((body->>'materials_expected')::boolean,false) else coalesce(cur_m.materials_expected,false) end,
   v_sent,case when body ? 'sent_on' then trim(coalesce(body->>'sent_note','')) else coalesce(cur_m.sent_note,'') end,
   who) returning id into target;
 elsif op='set_document_mark' then
  select * into cur_d from public.pto_document_marks where document_id=doc.id order by created_at desc,id desc limit 1;
  if body ? 'tn_status' and body->>'tn_status' is not null and body->>'tn_status' not in ('prep','tn','remarks','ok') then raise exception 'Неизвестный статус технадзора'; end if;
  if body ? 'original' and body->>'original' is not null and body->>'original' not in ('party','ours','accounting') then raise exception 'Неизвестное место оригинала'; end if;
  if body->>'tn_status'='remarks' and length(trim(coalesce(body->>'note','')))=0 then raise exception 'Опишите замечание технадзора'; end if;
  v_mat:=case when body ? 'materials' then pto_private.money_arg(body->>'materials','материалы заказчика') else cur_d.materials end;
  money_changed:=v_mat is distinct from cur_d.materials;
  -- Часть договора (ССР со своим НДС): только часть договора этого документа.
  v_part:=case when body ? 'part_id' then nullif(body->>'part_id','')::uuid else cur_d.part_id end;
  if v_part is not null then
   select * into part from public.pto_contract_parts where id=v_part;
   if not found or part.contract_id<>doc.contract_id then raise exception 'Часть не относится к договору документа'; end if;
  end if;
  money_changed:=money_changed or v_part is distinct from cur_d.part_id;
  insert into public.pto_document_marks(project_id,document_id,tn_status,part,materials,original,note,part_id,created_by)
  values(per.project_id,doc.id,
   case when body ? 'tn_status' then body->>'tn_status' else cur_d.tn_status end,
   case when v_part is not null then part.name when body ? 'part' then trim(coalesce(body->>'part','')) else coalesce(cur_d.part,'') end,
   v_mat,case when body ? 'original' then body->>'original' else cur_d.original end,
   trim(coalesce(body->>'note','')),v_part,who) returning id into target;
 else
  if coalesce(body->>'result','') not in ('ok','mismatch') then raise exception 'Укажите результат сверки'; end if;
  if coalesce(body->>'sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'Нужен хэш файла SHA-256'; end if;
  if body->>'result'='mismatch' and length(trim(coalesce(body->>'note','')))=0 then raise exception 'Опишите расхождение'; end if;
  insert into public.pto_file_checks(project_id,file_id,sha256,result,note,created_by)
  values(per.project_id,fil.id,body->>'sha256',body->>'result',trim(coalesce(body->>'note','')),who) returning id into target;
 end if;

 if money_changed then update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id; end if;
 insert into public.pto_events(project_id,period_id,document_id,actor,action,detail) values(per.project_id,per.id,doc.id,who,op,body);
 result:=jsonb_build_object('project_id',per.project_id,'period_id',per.id,'id',target);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.month_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.month_command(uuid,jsonb) to authenticated;

-- 4. Диспетчер: прежний (20261010210000) + части договора.
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

-- 5. Реестр (20261010230000) + строка на каждую часть договора и «Часть не указана», если сумма частей не сходится.
create or replace function public.pto_register_matrix(p_month date) returns jsonb
language sql stable set search_path='' as $$
with reg0 as (
 select r.period_id,r.project_id,r.contract_id,r.total::numeric(18,2) total,r.subcontract::numeric(18,2) subcontract
 from public.pto_register r where r.month=p_month
),
signed as (
 select w.period_id,w.contract_id,sum(v.amount)::numeric(18,2) amount
 from public.pto_workflows w
 join public.pto_periods p on p.id=w.period_id
 join public.pto_workflow_documents wd on wd.workflow_id=w.id
 join public.pto_documents d on d.id=wd.document_id and d.kind in ('c2a','c2b')
 join public.pto_versions v on v.id=d.current_version
 where p.month=p_month and w.template_code='claim' and w.step_code in ('signed','scan','accounting')
 group by 1,2
),
est as (
 select distinct on (e.period_id,e.contract_id) e.period_id,e.project_id,e.contract_id,e.amount
 from public.pto_estimates e join public.pto_periods p on p.id=e.period_id
 where p.month=p_month
 order by e.period_id,e.contract_id,e.created_at desc,e.id desc
),
reg as (
 select coalesce(r.period_id,e.period_id) period_id,coalesce(r.project_id,e.project_id) project_id,c.id contract_id,c.number,
  case when coalesce(r.total,0)<>0 then r.total else coalesce(s.amount,0) end::numeric(18,2) total,
  coalesce(r.subcontract,0)::numeric(18,2) subcontract,e.amount estimate,
  case when coalesce(r.total,0)<>0 then 'c3a' when coalesce(s.amount,0)<>0 then 'signed' end basis
 from reg0 r
 full join est e on e.period_id=r.period_id and e.contract_id=r.contract_id
 join public.pto_contracts c on c.id=coalesce(r.contract_id,e.contract_id)
 left join signed s on s.period_id=coalesce(r.period_id,e.period_id) and s.contract_id=c.id
 where coalesce(r.total,0)<>0 or coalesce(r.subcontract,0)<>0 or coalesce(e.amount,0)<>0 or coalesce(s.amount,0)<>0
),
-- Части договора: сумма актов по части (как «всего» договора: по С-3а — принятые версии, иначе подписанные).
parts as (
 select reg.period_id,reg.contract_id,pt.id part_id,pt.name,pt.vat_rate,pt.ordinal,sum(v.amount)::numeric(18,2) total
 from reg
 join public.pto_documents d on d.period_id=reg.period_id and d.contract_id=reg.contract_id and d.kind in ('c2a','c2b')
 join public.pto_document_marks_current dm on dm.document_id=d.id
 join public.pto_contract_parts pt on pt.id=dm.part_id
 join public.pto_versions v on v.id=case when reg.basis='c3a' then d.accepted_version else d.current_version end
 where reg.basis is not null
 group by 1,2,3,4,5,6
),
single as (
 select period_id from public.pto_register where month=p_month group by period_id having count(*)=1
),
-- Субподряд в их ценах (D): акты субподрядчиков объекта за месяц. Договор с заказчиком у объекта один (решение 10.10.2026).
-- Если исходящих договоров несколько, колонки по-прежнему из сопоставления (pto_allocations).
cells as (
 select d.period_id,reg.contract_id out_contract,d.contract_id in_contract,sum(v.amount)::numeric(18,2) amount
 from public.pto_documents d
 join public.pto_contracts ic on ic.id=d.contract_id and ic.direction='incoming'
 join public.pto_versions v on v.id=d.current_version
 join single s on s.period_id=d.period_id
 join reg on reg.period_id=d.period_id
 where d.kind in ('c2a','c2b')
 group by 1,2,3
 having sum(v.amount)<>0
 union all
 select a.period_id,o.contract_id,i.contract_id,sum(a.amount)::numeric(18,2)
 from public.pto_allocations a
 join public.pto_documents o on o.id=a.outgoing_document
 join public.pto_documents i on i.id=a.incoming_document
 join reg on reg.period_id=a.period_id and reg.contract_id=o.contract_id
 where a.period_id not in (select period_id from single)
 group by 1,2,3
 having sum(a.amount)<>0
),
-- «На заказчика» (F): из отметки субподрядчика за месяц, иначе из сопоставления.
fcells as (
 select r.period_id,r.contract_id out_contract,sm.contract_id in_contract,sm.on_customer amount
 from public.pto_sub_month_current sm
 join single s on s.period_id=sm.period_id
 join reg r on r.period_id=sm.period_id
 where sm.on_customer is not null
 union all
 select a.period_id,o.contract_id,i.contract_id,sum(a.amount)::numeric(18,2)
 from public.pto_allocations a
 join public.pto_documents o on o.id=a.outgoing_document
 join public.pto_documents i on i.id=a.incoming_document
 join reg on reg.period_id=a.period_id and reg.contract_id=o.contract_id
 where not exists(select 1 from public.pto_sub_month_current sm join single s on s.period_id=sm.period_id
  where sm.period_id=a.period_id and sm.contract_id=i.contract_id and sm.on_customer is not null)
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
 select id,case when count(*) over(partition by party_key)>1 then base||' · №'||number else base end label from cols
),
rows_c as (
 select reg.project_id,p.name project,reg.contract_id,reg.number,reg.total,reg.subcontract,(reg.total-reg.subcontract)::numeric(18,2) own,reg.estimate,reg.basis,
  coalesce((select jsonb_object_agg(c.in_contract,c.amount::text) from cells c where c.period_id=reg.period_id and c.out_contract=reg.contract_id),'{}'::jsonb) cells,
  coalesce((select jsonb_object_agg(c.in_contract,c.amount::text) from fcells c where c.period_id=reg.period_id and c.out_contract=reg.contract_id),'{}'::jsonb) customer_cells
 from reg join public.pto_projects p on p.id=reg.project_id
),
rows_p as (
 select rc.project_id,rc.project,sum(rc.total)::numeric(18,2) total,sum(rc.subcontract)::numeric(18,2) subcontract,sum(rc.own)::numeric(18,2) own,
  sum(rc.estimate)::numeric(18,2) estimate,
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
 'rows',coalesce((select jsonb_agg(x.j order by x.project,x.project_id,x.ord,x.number,x.sub) from (
   select rc.project,rc.project_id,0 ord,rc.number,pt.ordinal sub,jsonb_build_object('kind','part','project_id',rc.project_id,'project',rc.project,'contract_id',rc.contract_id,
    'number',rc.number,'part_id',pt.part_id,'part',pt.name,'vat_rate',pt.vat_rate::text,'total',pt.total::text) j
   from rows_c rc join reg on reg.contract_id=rc.contract_id join parts pt on pt.period_id=reg.period_id and pt.contract_id=rc.contract_id
   union all
   select rc.project,rc.project_id,0,rc.number,2147483646,jsonb_build_object('kind','part','project_id',rc.project_id,'project',rc.project,'contract_id',rc.contract_id,
    'number',rc.number,'part_id',null,'part','Часть не указана','vat_rate',null,'total',(rc.total-s.total)::text)
   from rows_c rc join reg on reg.contract_id=rc.contract_id
   join (select period_id,contract_id,sum(total) total from parts group by 1,2) s on s.period_id=reg.period_id and s.contract_id=rc.contract_id
   where rc.total<>s.total
   union all
   select project,project_id,0 ord,number,2147483647 sub,jsonb_build_object('kind','contract','project_id',project_id,'project',project,'contract_id',contract_id,'number',number,
    'total',total::text,'own',own::text,'subcontract',subcontract::text,'estimate',estimate::text,'basis',basis,'cells',cells,'customer_cells',customer_cells,'has_parts',exists(select 1 from parts p join reg r on r.period_id=p.period_id where p.contract_id=rows_c.contract_id)) j from rows_c
   union all
   select project,project_id,1,'',0,jsonb_build_object('kind','project','project_id',project_id,'project',project,
    'total',total::text,'own',own::text,'subcontract',subcontract::text,'estimate',estimate::text,'cells',cells) from rows_p) x),'[]'::jsonb),
 'total',jsonb_build_object(
  'total',(select coalesce(sum(total),0) from reg)::numeric(18,2)::text,
  'subcontract',(select coalesce(sum(subcontract),0) from reg)::numeric(18,2)::text,
  'own',(select coalesce(sum(total-subcontract),0) from reg)::numeric(18,2)::text,
  'estimate',(select sum(estimate) from reg)::numeric(18,2)::text,
  'cells',coalesce((select jsonb_object_agg(t.in_contract,t.s::text) from (select in_contract,sum(amount)::numeric(18,2) s from cells group by 1) t),'{}'::jsonb))
);
$$;
revoke all on function public.pto_register_matrix(date) from public, anon;
grant execute on function public.pto_register_matrix(date) to authenticated;
