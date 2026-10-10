-- Откат миграции 20261010235000_sent_and_contract_parts.sql: убирает дату отправки заказчику и части договора.
-- Внимание: удаляет части договора и привязку документов к ним. Функции — из 20261010210000 и 20261010230000.
-- После выполнения удалить запись версии 20261010235000 из supabase_migrations.schema_migrations.

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
 'rows',coalesce((select jsonb_agg(x.j order by x.project,x.project_id,x.ord,x.number) from (
   select project,project_id,0 ord,number,jsonb_build_object('kind','contract','project_id',project_id,'project',project,'contract_id',contract_id,'number',number,
    'total',total::text,'own',own::text,'subcontract',subcontract::text,'estimate',estimate::text,'basis',basis,'cells',cells,'customer_cells',customer_cells) j from rows_c
   union all
   select project,project_id,1,'',jsonb_build_object('kind','project','project_id',project_id,'project',project,
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
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

create or replace function pto_private.month_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; per public.pto_periods; con public.pto_contracts; doc public.pto_documents; fil public.pto_files;
 cur_s public.pto_sub_month; cur_m public.pto_month_marks; cur_d public.pto_document_marks;
 op text:=body->>'op'; target uuid; result jsonb; prior pto_private.requests; money_changed boolean:=false;
 v_plan numeric; v_on numeric; v_eq numeric; v_to numeric; v_co numeric; v_mat numeric;
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
  insert into public.pto_month_marks(project_id,period_id,equipment_expected,materials_expected,created_by)
  values(per.project_id,per.id,
   case when body ? 'equipment_expected' then coalesce((body->>'equipment_expected')::boolean,false) else coalesce(cur_m.equipment_expected,false) end,
   case when body ? 'materials_expected' then coalesce((body->>'materials_expected')::boolean,false) else coalesce(cur_m.materials_expected,false) end,
   who) returning id into target;
 elsif op='set_document_mark' then
  select * into cur_d from public.pto_document_marks where document_id=doc.id order by created_at desc,id desc limit 1;
  if body ? 'tn_status' and body->>'tn_status' is not null and body->>'tn_status' not in ('prep','tn','remarks','ok') then raise exception 'Неизвестный статус технадзора'; end if;
  if body ? 'original' and body->>'original' is not null and body->>'original' not in ('party','ours','accounting') then raise exception 'Неизвестное место оригинала'; end if;
  if body->>'tn_status'='remarks' and length(trim(coalesce(body->>'note','')))=0 then raise exception 'Опишите замечание технадзора'; end if;
  v_mat:=case when body ? 'materials' then pto_private.money_arg(body->>'materials','материалы заказчика') else cur_d.materials end;
  money_changed:=v_mat is distinct from cur_d.materials;
  insert into public.pto_document_marks(project_id,document_id,tn_status,part,materials,original,note,created_by)
  values(per.project_id,doc.id,
   case when body ? 'tn_status' then body->>'tn_status' else cur_d.tn_status end,
   case when body ? 'part' then trim(coalesce(body->>'part','')) else coalesce(cur_d.part,'') end,
   v_mat,case when body ? 'original' then body->>'original' else cur_d.original end,
   trim(coalesce(body->>'note','')),who) returning id into target;
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

drop function pto_private.part_command(uuid,jsonb);
drop view public.pto_document_marks_current;
alter table public.pto_document_marks drop column part_id;
create view public.pto_document_marks_current with(security_invoker=true) as
select distinct on (document_id) * from public.pto_document_marks order by document_id,created_at desc,id desc;
drop table public.pto_contract_parts;
drop view public.pto_month_marks_current;
alter table public.pto_month_marks drop column sent_on, drop column sent_note;
create view public.pto_month_marks_current with(security_invoker=true) as
select distinct on (period_id) * from public.pto_month_marks order by period_id,created_at desc,id desc;
revoke all on public.pto_document_marks_current, public.pto_month_marks_current from anon, authenticated;
grant select on public.pto_document_marks_current, public.pto_month_marks_current to authenticated;
