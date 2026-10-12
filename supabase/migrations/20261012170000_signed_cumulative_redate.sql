-- Замечания пользователя 12.10.2026 (тред «Документы месяца»):
-- 1. Накопление справки С-3а: прошлый месяц входит в «с начала года» и «с начала работ» уже с шага «Проверено»
--    (по текущей версии справки), а не только после принятия бухгалтерией.
-- 2. Дата подписания (и любая дата шага) исправляется: команда workflow_redate добавляет событие «redate»
--    со ссылкой на переход; журнал только дополняется, в датах шагов берётся последнее исправление.
-- Откат: supabase/rollback/20261012170000_signed_cumulative_redate.down.sql

create or replace view public.pto_c3a_report with(security_invoker=true) as
with v as (
 select v.id version_id,d.id document_id,d.project_id,d.period_id,d.contract_id,d.number,p.month,v.version,
  d.accepted_version=v.id accepted,d.current_version=v.id is_current,
  v.amount::numeric(18,2) smr,
  coalesce(v.smr_vat,0)::numeric(18,2) smr_vat,
  coalesce(v.equipment_amount,0)::numeric(18,2) equipment,
  coalesce(v.equipment_vat,0)::numeric(18,2) equipment_vat,
  coalesce(v.advance_target_offset,0)::numeric(18,2) target_offset,
  coalesce(v.advance_current_offset,0)::numeric(18,2) current_offset
 from public.pto_versions v
 join public.pto_documents d on d.id=v.document_id
 join public.pto_periods p on p.id=d.period_id
 where d.kind='c3a'
),
-- Накопление: прошлый месяц входит с шага «Проверено» (текущая версия), до него — только принятая бухгалтерией версия.
acc as (
 select v.* from v join public.pto_documents d on d.id=v.document_id
 where v.version_id=case when exists(select 1 from public.pto_workflow_documents wd join public.pto_workflows w on w.id=wd.workflow_id
   where wd.document_id=d.id and w.step_code in ('signed','accepted','closed')) then d.current_version else d.accepted_version end
)
select v.*,
 (v.smr+v.equipment-v.target_offset-v.current_offset)::numeric(18,2) to_pay,
 (y.smr+v.smr)::numeric(18,2) ytd_smr,
 (y.smr_vat+v.smr_vat)::numeric(18,2) ytd_smr_vat,
 (y.equipment+v.equipment)::numeric(18,2) ytd_equipment,
 (y.equipment_vat+v.equipment_vat)::numeric(18,2) ytd_equipment_vat,
 (y.target_offset+v.target_offset)::numeric(18,2) ytd_target_offset,
 (y.current_offset+v.current_offset)::numeric(18,2) ytd_current_offset,
 (y.smr+v.smr+y.equipment+v.equipment-y.target_offset-v.target_offset-y.current_offset-v.current_offset)::numeric(18,2) ytd_to_pay,
 (s.smr+v.smr)::numeric(18,2) total_smr,
 (s.smr_vat+v.smr_vat)::numeric(18,2) total_smr_vat,
 (s.equipment+v.equipment)::numeric(18,2) total_equipment,
 (s.equipment_vat+v.equipment_vat)::numeric(18,2) total_equipment_vat,
 (s.target_offset+v.target_offset)::numeric(18,2) total_target_offset,
 (s.current_offset+v.current_offset)::numeric(18,2) total_current_offset,
 (s.smr+v.smr+s.equipment+v.equipment-s.target_offset-v.target_offset-s.current_offset-v.current_offset)::numeric(18,2) total_to_pay
from v
cross join lateral (select coalesce(sum(a.smr),0) smr,coalesce(sum(a.smr_vat),0) smr_vat,coalesce(sum(a.equipment),0) equipment,coalesce(sum(a.equipment_vat),0) equipment_vat,coalesce(sum(a.target_offset),0) target_offset,coalesce(sum(a.current_offset),0) current_offset from acc a where a.contract_id=v.contract_id and a.month<v.month and a.month>=date_trunc('year',v.month)::date) y
cross join lateral (select coalesce(sum(a.smr),0) smr,coalesce(sum(a.smr_vat),0) smr_vat,coalesce(sum(a.equipment),0) equipment,coalesce(sum(a.equipment_vat),0) equipment_vat,coalesce(sum(a.target_offset),0) target_offset,coalesce(sum(a.current_offset),0) current_offset from acc a where a.contract_id=v.contract_id and a.month<v.month) s;
revoke all on public.pto_c3a_report from anon, authenticated;
grant select on public.pto_c3a_report to authenticated;

alter table public.pto_workflow_events drop constraint pto_workflow_events_kind_check;
alter table public.pto_workflow_events add constraint pto_workflow_events_kind_check
 check (kind = any (array['created','advance','return','reset','start','undo','note','note_off','received','revised','redate']));

create or replace function pto_private.workflow_redate_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; prior pto_private.requests; result jsonb;
 wf public.pto_workflows; per public.pto_periods; ev public.pto_workflow_events; old_date date; date_value date;
 step_value text:=trim(coalesce(body->>'step','')); note_value text:=trim(coalesce(body->>'note',''));
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 role_name:=pto_private.my_role();
 if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 if role_name not in ('head','engineer') then raise exception 'Дату исправляют начальник ПТО и инженер' using errcode='42501'; end if;
 date_value:=nullif(body->>'date','')::date;
 if date_value is null then raise exception 'Укажите дату'; end if;
 if date_value>current_date then raise exception 'Дата не может быть позже сегодняшней'; end if;
 select * into wf from public.pto_workflows where id=(body->>'workflow_id')::uuid for update;
 if not found then raise exception 'Комплект не найден'; end if;
 if not coalesce(pto_private.can_access(wf.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 select * into per from public.pto_periods where id=wf.period_id;
 if per.status='closed' then raise exception 'Месяц закрыт: дату не исправить'; end if;
 select * into ev from public.pto_workflow_events a
  where a.workflow_id=wf.id and a.kind in ('start','advance') and a.from_step=step_value
   and not exists(select 1 from public.pto_workflow_events u where u.ref_event=a.id and u.kind='undo')
  order by a.id desc limit 1;
 if not found then raise exception 'Этот шаг ещё не пройден'; end if;
 old_date:=coalesce((select r.event_date from public.pto_workflow_events r where r.ref_event=ev.id and r.kind='redate' order by r.id desc limit 1),ev.event_date,ev.created_at::date);
 if old_date=date_value then raise exception 'Дата не изменилась'; end if;
 insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,event_date,ref_event,note)
 values(wf.id,'redate',ev.from_step,ev.to_step,who,date_value,ev.id,
  'Дата исправлена, была '||to_char(old_date,'DD.MM.YYYY')||coalesce(nullif(': '||note_value,': '),''));
 insert into public.pto_events(project_id,period_id,actor,action,detail)
 values(wf.project_id,wf.period_id,who,'workflow_redate',body || jsonb_build_object('was',old_date,'template',wf.template_code));
 result:=jsonb_build_object('workflow_id',wf.id,'step',ev.from_step,'date',date_value,'was',old_date);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.workflow_redate_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.workflow_redate_command(uuid,jsonb) to authenticated;

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
  else pto_private.command(request_id,payload)
 end;
end
$$;

revoke all on function public.pto_command(uuid,jsonb) from public,anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

create or replace view public.pto_workflow_list with(security_invoker=true) as
select w.*,t.name template_name,t.money,t.ordinal template_ordinal,s.label step_label,s.ordinal step_ordinal,s.actor,s.hint,
 (select max(x.ordinal) from public.pto_workflow_steps x where x.template_code=w.template_code) last_ordinal,
 pr.name project,c.number contract_number,coalesce(cp.short_name,c.party_text) party,per.month,
 (select count(*) from public.pto_workflow_documents wd where wd.workflow_id=w.id)::int documents,
 (select coalesce(sum(v.amount),0) from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
  join public.pto_versions v on v.id=d.current_version where wd.workflow_id=w.id and d.kind in ('c2a','c2b'))::numeric(18,2) acts_amount,
 le.created_at last_event_at,le.kind last_event_kind,le.note last_note,
 case when le.kind in ('return','reset') then le.document_id end attention_document_id,
 coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'source',n.source,'person',n.person,'round',n.round,
   'date',coalesce(n.event_date,n.created_at::date),'step',n.from_step,'document_id',n.document_id) order by n.id)
  from public.pto_workflow_events n where n.workflow_id=w.id and n.kind='note'
  and not exists(select 1 from public.pto_workflow_events o where o.ref_event=n.id and o.kind='note_off')),'[]'::jsonb) open_notes,
 coalesce((select jsonb_object_agg(m.from_step,coalesce((select r.event_date from public.pto_workflow_events r where r.ref_event=m.id and r.kind='redate' order by r.id desc limit 1),m.event_date,m.created_at::date)) from (
   select distinct on (a.from_step) a.id,a.from_step,a.event_date,a.created_at from public.pto_workflow_events a
   where a.workflow_id=w.id and a.kind in ('start','advance') and a.from_step is not null
    and not exists(select 1 from public.pto_workflow_events u where u.ref_event=a.id and u.kind='undo')
   order by a.from_step,a.id desc) m),'{}'::jsonb) step_dates,
 lm.created_at step_since,lm.kind last_move_kind,lm.actor last_move_actor,
 (select coalesce(r.event_date,r.created_at::date) from public.pto_workflow_events r where r.workflow_id=w.id and r.kind='received' order by r.id desc limit 1) received_on
from public.pto_workflows w
join public.pto_workflow_templates t on t.code=w.template_code
join public.pto_workflow_steps s on s.template_code=w.template_code and s.code=w.step_code
join public.pto_projects pr on pr.id=w.project_id
join public.pto_periods per on per.id=w.period_id
join public.pto_contracts c on c.id=w.contract_id
left join public.pto_counterparties cp on cp.id=c.counterparty_id
left join lateral (select e.* from public.pto_workflow_events e where e.workflow_id=w.id order by e.id desc limit 1) le on true
left join lateral (select e.* from public.pto_workflow_events e where e.workflow_id=w.id and e.kind in ('created','start','advance','undo') order by e.id desc limit 1) lm on true;
revoke all on public.pto_workflow_list from anon, authenticated;
grant select on public.pto_workflow_list to authenticated;
