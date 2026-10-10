-- Реестр: своими силами = всего − субподряд в их ценах (Σ актов субподрядчиков за месяц), решение пользователя 10.10.2026
-- (docs/month.md, тред «Вкладка «Месяц» в объекте»). Генуслуги (F − D) входят в свои силы. У объекта один договор с заказчиком,
-- поэтому все акты субподрядчиков объекта относятся к нему. Если исходящих договоров у объекта в месяце несколько,
-- субподряд по-прежнему берётся из сопоставления (pto_allocations).
-- Колонки субподрядчиков в реестре — суммы их актов (D); «на заказчика» (F) отдаётся отдельно (customer_cells):
-- из отметки субподрядчика за месяц (pto_sub_month), иначе из сопоставления.
-- Снимок реестра при закрытии месяца берёт pto_register, поэтому новые снимки тоже по D; старые снимки не меняются.

create or replace view public.pto_register with(security_invoker=true) as
with base as (
 select p.id period_id,p.project_id,p.month,p.status,p.revision,c.id contract_id,c.number,coalesce(cp.short_name,c.party_text) party,
  coalesce((select sum(v.amount) from public.pto_documents d join public.pto_versions v on v.id=d.accepted_version
  where d.period_id=p.id and d.contract_id=c.id and d.kind in ('c2a','c2b')),0)::numeric(16,2) total,
  coalesce((select sum(a.amount) from public.pto_allocations a join public.pto_documents d on d.id=a.outgoing_document
  where a.period_id=p.id and d.contract_id=c.id),0)::numeric(16,2) allocated,
  count(*) over(partition by p.id) outgoing
 from public.pto_periods p
 join public.pto_contracts c on c.project_id=p.project_id and c.direction='outgoing'
 left join public.pto_counterparties cp on cp.id=c.counterparty_id
 where exists(select 1 from public.pto_documents d where d.period_id=p.id and d.contract_id=c.id)
)
select period_id,project_id,month,status,revision,contract_id,number,party,total,
 case when outgoing=1 then coalesce((select sum(v.amount) from public.pto_documents d
   join public.pto_contracts ic on ic.id=d.contract_id and ic.direction='incoming'
   join public.pto_versions v on v.id=d.current_version
   where d.period_id=base.period_id and d.kind in ('c2a','c2b')),0)
  else allocated end::numeric(16,2) subcontract
from base;

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
