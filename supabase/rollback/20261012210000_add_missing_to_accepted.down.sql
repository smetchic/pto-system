-- Откат 20261012210000_add_missing_to_accepted: прежняя функция из 20261008220000_signing_steps.

create or replace function pto_private.workflow_link(doc_id uuid, actor_id uuid, reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.pto_documents; tpl text; wf public.pto_workflows; st public.pto_workflow_steps; start_step text; c29 public.pto_workflows; fresh boolean;
begin
 select * into d from public.pto_documents where id=doc_id;
 tpl:=pto_private.workflow_template_for(d.kind,(select direction from public.pto_contracts where id=d.contract_id));
 select code into start_step from public.pto_workflow_steps where template_code=tpl and ordinal=2;
 insert into public.pto_workflows(template_code,project_id,period_id,contract_id,step_code)
 values(tpl,d.project_id,d.period_id,d.contract_id,start_step)
 on conflict(period_id,contract_id,template_code) do nothing;
 select * into wf from public.pto_workflows where period_id=d.period_id and contract_id=d.contract_id and template_code=tpl for update;
 fresh:=not exists(select 1 from public.pto_workflow_events where workflow_id=wf.id);
 if fresh then
  insert into public.pto_workflow_events(workflow_id,kind,to_step,actor,note) values(wf.id,'created',wf.step_code,actor_id,'Комплект создан');
 end if;
 if wf.step_code='accepted' then raise exception 'Комплект передан в бухгалтерию: чтобы изменить документы, отмените переход'; end if;
 insert into public.pto_workflow_documents(workflow_id,document_id) values(wf.id,d.id) on conflict do nothing;
 select * into st from public.pto_workflow_steps where template_code=wf.template_code and code=wf.step_code;
 if not fresh then
  -- Изменение после отправки заказчику, после получения комплекта субподрядчика или после проверки — замечание.
  if wf.step_code='signed' or (wf.step_code='check' and (wf.template_code='claim'
   or (wf.template_code='sub_claim' and exists(select 1 from public.pto_workflow_events where workflow_id=wf.id and kind='received')))) then
   insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,source,round,note)
   values(wf.id,'note',wf.step_code,wf.step_code,actor_id,d.id,'система',
    (select count(*)+1 from public.pto_workflow_events e where e.workflow_id=wf.id and e.kind='note' and e.from_step=wf.step_code),
    case when wf.template_code='claim' then 'Комплект изменён после отправки заказчику: ' else 'Комплект изменён после получения: ' end||reason);
  else
   insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,note)
   values(wf.id,'revised',wf.step_code,wf.step_code,actor_id,d.id,reason);
  end if;
 end if;
 -- С-29 строится по актам: при изменении актов отмечается «основание изменилось».
 if d.kind in ('c2a','c2b') then
  select * into c29 from public.pto_workflows where period_id=d.period_id and contract_id=d.contract_id and template_code='c29' for update;
  if found and c29.step_code in ('tn','check','signed') then
   insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,source,round,note)
   values(c29.id,'note',c29.step_code,c29.step_code,actor_id,d.id,'система',
    (select count(*)+1 from public.pto_workflow_events e where e.workflow_id=c29.id and e.kind='note' and e.from_step=c29.step_code),
    'Основание изменилось: '||reason);
  end if;
 end if;
 return wf.id;
end $$;
