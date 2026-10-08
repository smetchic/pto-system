-- Откат миграции 20261008220000_signing_steps.sql: прежние шаги маршрутов, возврат назад вместо замечаний.
-- Функции и представление — из 20261005224629 (workflow_link, pto_workflow_list), 20261005230629 (workflow_command), 20261008180000 (pto_command).
-- Журнал событий только на добавление: новые события (замечания, отмены, даты) и их колонки остаются, прежний код их не читает.
-- Снятые ожидания удаляются вместе с таблицей. Комплекты переходят на ближайший прежний шаг.
-- После выполнения удалить запись версии 20261008220000 из supabase_migrations.schema_migrations.

drop view public.pto_workflow_list;
create view public.pto_workflow_list with(security_invoker=true) as
select w.*,t.name template_name,t.money,t.ordinal template_ordinal,s.label step_label,s.ordinal step_ordinal,s.actor,s.hint,
 (select max(x.ordinal) from public.pto_workflow_steps x where x.template_code=w.template_code) last_ordinal,
 pr.name project,c.number contract_number,coalesce(cp.short_name,c.party_text) party,per.month,
 (select count(*) from public.pto_workflow_documents wd where wd.workflow_id=w.id)::int documents,
 (select coalesce(sum(v.amount),0) from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
  join public.pto_versions v on v.id=d.current_version where wd.workflow_id=w.id and d.kind in ('c2a','c2b'))::numeric(18,2) acts_amount,
 le.created_at last_event_at,le.kind last_event_kind,le.note last_note,
 case when le.kind in ('return','reset') then le.document_id end attention_document_id
from public.pto_workflows w
join public.pto_workflow_templates t on t.code=w.template_code
join public.pto_workflow_steps s on s.template_code=w.template_code and s.code=w.step_code
join public.pto_projects pr on pr.id=w.project_id
join public.pto_periods per on per.id=w.period_id
join public.pto_contracts c on c.id=w.contract_id
left join public.pto_counterparties cp on cp.id=c.counterparty_id
left join lateral (select e.* from public.pto_workflow_events e where e.workflow_id=w.id order by e.id desc limit 1) le on true;
revoke all on public.pto_workflow_list from anon, authenticated;
grant select on public.pto_workflow_list to authenticated;

create or replace function pto_private.workflow_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op';
 wf public.pto_workflows; per public.pto_periods; cur public.pto_workflow_steps; nxt public.pto_workflow_steps;
 problem text; attention uuid; result jsonb; prior pto_private.requests;
 person_value text:=trim(coalesce(body->>'person','')); method_value text:=trim(coalesce(body->>'method',''));
 proof_value text:=trim(coalesce(body->>'proof','')); note_value text:=trim(coalesce(body->>'note',''));
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
 select * into wf from public.pto_workflows where id=(body->>'workflow_id')::uuid for update;
 if not found then raise exception 'Комплект не найден'; end if;
 if not coalesce(pto_private.can_access(wf.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 select * into per from public.pto_periods where id=wf.period_id for update;
 if per.status<>'open' then raise exception 'Период закрыт'; end if;
 if nullif(body->>'expected_revision','') is not null and (body->>'expected_revision')::integer is distinct from per.revision then
  raise exception 'Данные уже изменились. Обновите страницу' using errcode='40001';
 end if;
 select * into cur from public.pto_workflow_steps where template_code=wf.template_code and code=wf.step_code;
 if cur.actor='none' then raise exception 'Маршрут завершён'; end if;
 -- Бухгалтерия системой не пользуется: все шаги, включая передачу и принятие бухгалтерией, отмечает ПТО.
 if role_name not in ('head','engineer') then raise exception 'Шаги маршрута отмечает ПТО' using errcode='42501'; end if;

 if op='workflow_advance' then
  select * into nxt from public.pto_workflow_steps where template_code=wf.template_code and ordinal=cur.ordinal+1;
  if 'kit'=any(nxt.requires) then
   problem:=pto_private.kit_problem(wf.id);
   if problem is not null then raise exception '%',problem; end if;
  end if;
  if 'person'=any(nxt.requires) and length(person_value)<2 then raise exception 'Укажите, кому передан комплект'; end if;
  if 'method'=any(nxt.requires) and length(method_value)=0 then raise exception 'Укажите способ передачи'; end if;
  if 'proof'=any(nxt.requires) and length(proof_value)<3 then raise exception 'Укажите подтверждение: номер письма, описи, отметку о подписи'; end if;
  if 'files'=any(nxt.requires) and exists(
   select 1 from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
   where wd.workflow_id=wf.id and not exists(select 1 from public.pto_files f where f.version_id=d.current_version)
  ) then raise exception 'Приложите файл к каждому документу комплекта'; end if;
  if 'accept'=any(nxt.requires) then
   -- Бухгалтерия принимает комплект целиком: все текущие версии становятся принятыми.
   update public.pto_documents d set accepted_version=d.current_version
   from public.pto_workflow_documents wd where wd.workflow_id=wf.id and wd.document_id=d.id;
  end if;
  update public.pto_workflows set step_code=nxt.code,updated_at=now() where id=wf.id;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,person,method,proof,note)
  values(wf.id,'advance',cur.code,nxt.code,who,person_value,method_value,proof_value,note_value);
 elsif op='workflow_return' then
  select * into nxt from public.pto_workflow_steps where template_code=wf.template_code and code=body->>'to_step';
  if not found or nxt.ordinal>=cur.ordinal then raise exception 'Вернуть можно только на один из предыдущих шагов'; end if;
  if length(note_value)<3 then raise exception 'Укажите причину возврата'; end if;
  attention:=nullif(body->>'document_id','')::uuid;
  if attention is not null and not exists(select 1 from public.pto_workflow_documents where workflow_id=wf.id and document_id=attention) then
   raise exception 'Документ не входит в комплект';
  end if;
  update public.pto_workflows set step_code=nxt.code,updated_at=now() where id=wf.id;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,note)
  values(wf.id,'return',cur.code,nxt.code,who,attention,note_value);
 else
  raise exception 'Неизвестная операция';
 end if;

 update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id;
 insert into public.pto_events(project_id,period_id,document_id,actor,action,detail)
 values(wf.project_id,wf.period_id,attention,who,op,body || jsonb_build_object('from',cur.code,'to',nxt.code,'template',wf.template_code));
 result:=jsonb_build_object('workflow_id',wf.id,'project_id',wf.project_id,'period_id',wf.period_id,'step',nxt.code);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.workflow_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.workflow_command(uuid,jsonb) to authenticated;

create or replace function pto_private.workflow_link(doc_id uuid, actor_id uuid, reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.pto_documents; tpl text; wf public.pto_workflows; first_step text;
begin
 select * into d from public.pto_documents where id=doc_id;
 tpl:=pto_private.workflow_template_for(d.kind,(select direction from public.pto_contracts where id=d.contract_id));
 select code into first_step from public.pto_workflow_steps where template_code=tpl and ordinal=1;
 insert into public.pto_workflows(template_code,project_id,period_id,contract_id,step_code)
 values(tpl,d.project_id,d.period_id,d.contract_id,first_step)
 on conflict(period_id,contract_id,template_code) do nothing;
 select * into wf from public.pto_workflows where period_id=d.period_id and contract_id=d.contract_id and template_code=tpl for update;
 if not exists(select 1 from public.pto_workflow_events where workflow_id=wf.id) then
  insert into public.pto_workflow_events(workflow_id,kind,to_step,actor,note) values(wf.id,'created',wf.step_code,actor_id,'Комплект создан');
 end if;
 insert into public.pto_workflow_documents(workflow_id,document_id) values(wf.id,d.id) on conflict do nothing;
 perform pto_private.workflow_reset(wf.id,actor_id,d.id,reason);
 return wf.id;
end $$;
revoke all on function pto_private.workflow_link(uuid,uuid,text) from public, anon, authenticated;

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
  when payload->>'op' in ('workflow_advance','workflow_return') then pto_private.workflow_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

drop function pto_private.subs_problem(uuid);
drop function pto_private.month_period(uuid,date);
drop table public.pto_workflow_skips;

-- Шаги: новые убираются, прежние возвращаются.
alter table public.pto_workflows drop constraint pto_workflows_template_code_step_code_fkey;
update public.pto_workflows set step_code=case template_code
 when 'claim' then case step_code when 'wait' then 'prepared' when 'acts' then 'prepared' when 'tn' then 'supervision' when 'check' then 'customer' else step_code end
 when 'sub_claim' then case step_code when 'wait' then 'received' when 'tn' then 'received' when 'check' then 'review' else step_code end
 else case step_code when 'wait' then 'formation' when 'acts' then 'formation' when 'tn' then 'site' when 'check' then 'review' when 'signed' then 'checked' else step_code end
end,updated_at=now();
delete from public.pto_workflow_steps;
alter table public.pto_workflow_steps drop constraint pto_workflow_steps_requires_check;
alter table public.pto_workflow_steps add constraint pto_workflow_steps_requires_check
 check (requires <@ array['kit','person','method','proof','files','accept']);
comment on column public.pto_workflow_steps.requires is 'Условия перехода НА шаг: kit — состав и суммы комплекта, person/method/proof — кому, как, подтверждение, files — файл у каждой версии, accept — фиксация принятых версий.';
insert into public.pto_workflow_steps(template_code,code,ordinal,label,actor,requires,hint) values
 ('claim','prepared',1,'Подготовлена ПТО','pto','{}','Соберите акты С-2 и справку С-3а, проверьте суммы, передайте прорабу.'),
 ('claim','site',2,'У прораба','pto','{kit,person}','Прораб проверяет комплект и передаёт технадзору.'),
 ('claim','supervision',3,'Технадзор','pto','{kit,person}','Технадзор визирует комплект; после визы направьте его заказчику.'),
 ('claim','customer',4,'Направлена заказчику','pto','{kit,person,method,proof}','Комплект у заказчика. Зафиксируйте подписание.'),
 ('claim','signed',5,'Подписана заказчиком','pto','{kit,proof}','Приложите сканы подписанных документов и сверьте их.'),
 ('claim','scan',6,'Скан приложен и сверен','pto','{kit,files}','Передайте оригиналы в бухгалтерию.'),
 ('claim','accounting',7,'Оригинал в бухгалтерии','accounting','{kit,files,person,proof}','Бухгалтерия принимает комплект целиком или возвращает с причиной.'),
 ('claim','accepted',8,'Принято бухгалтерией','accounting','{kit,files,accept}','Комплект принят. Закройте его.'),
 ('claim','closed',9,'Закрыто','none','{}',''),
 ('sub_claim','received',1,'Получена','pto','{}','Проверьте процентовку субподрядчика.'),
 ('sub_claim','review',2,'Проверка ПТО','pto','{kit}','Замечания — возврат с причиной; после исправления — согласование.'),
 ('sub_claim','agreed',3,'Согласована','pto','{kit,proof}','Подпишите процентовку.'),
 ('sub_claim','signed',4,'Подписана','pto','{kit,proof}','Передайте оригиналы в бухгалтерию.'),
 ('sub_claim','accounting',5,'Передана в бухгалтерию','accounting','{kit,files,person,proof}','Бухгалтерия принимает или возвращает с причиной.'),
 ('sub_claim','accepted',6,'Принято бухгалтерией','accounting','{kit,files,accept}','Комплект принят. Закройте его.'),
 ('sub_claim','closed',7,'Закрыто','none','{}',''),
 ('c29','formation',1,'Формирование ПТО','pto','{}','Сформируйте С-29 и передайте прорабу.'),
 ('c29','site',2,'У прораба','pto','{kit,person}','Прораб заполняет фактический расход и объяснения.'),
 ('c29','review',3,'Проверка ПТО','pto','{kit}','Замечания — возврат прорабу с причиной.'),
 ('c29','checked',4,'Проверено','pto','{kit,proof}','Передайте С-29 в бухгалтерию.'),
 ('c29','accounting',5,'Передано в бухгалтерию','accounting','{kit,files,person,proof}','Бухгалтерия принимает или возвращает с причиной.'),
 ('c29','accepted',6,'Принято бухгалтерией','accounting','{kit,files,accept}','С-29 принят. Закройте.'),
 ('c29','closed',7,'Закрыто','none','{}','');
update public.pto_workflow_steps set requires=array['kit','files','person','proof','accept']
where code='accepted';
update public.pto_workflow_steps set hint=case code
 when 'accounting' then 'Оригиналы у бухгалтерии. Отметьте принятие (кто принял, подтверждение) или верните с причиной.'
 when 'accepted' then 'Бухгалтерия приняла комплект. Закройте его.'
 else hint end
where code in ('accounting','accepted');
alter table public.pto_workflows add constraint pto_workflows_template_code_step_code_fkey
 foreign key(template_code,step_code) references public.pto_workflow_steps(template_code,code);
