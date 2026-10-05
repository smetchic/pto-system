-- Шаг 7 плана: система — внутренний инструмент ПТО (решение пользователя: бухгалтерия не подключается).
-- * роли: администратор, начальник ПТО, инженер ПТО; роль «Бухгалтерия» больше не назначается;
-- * шаги «в бухгалтерии», «принято бухгалтерией», «закрыто» отмечает ПТО; при принятии указывается, кто в бухгалтерии принял, и подтверждение;
-- * тема оформления хранится в профиле пользователя.
-- Откат: supabase/rollback/20261005225931_pto_only_roles.down.sql

-- 1. Роли только ПТО.
alter table public.pto_profiles drop constraint pto_profiles_role_check;
alter table public.pto_profiles add constraint pto_profiles_role_check check (role in ('head','engineer','admin'));

-- 2. Тема оформления в профиле.
alter table public.pto_profiles add column theme text not null default 'system' check (theme in ('light','dark','system'));

create or replace function pto_private.profile_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); result jsonb; prior pto_private.requests;
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 if pto_private.my_role() is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 if body->>'op'<>'set_theme' or body->>'theme' not in ('light','dark','system') then raise exception 'Неизвестная тема оформления'; end if;
 -- Только собственная настройка отображения: событие в журнал не пишется.
 update public.pto_profiles set theme=body->>'theme' where id=who;
 result:=jsonb_build_object('theme',body->>'theme');
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.profile_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.profile_command(uuid,jsonb) to authenticated;

-- 3. Шаги бухгалтерии отмечает ПТО: кто в бухгалтерии принял и подтверждение.
update public.pto_workflow_steps set requires=array['kit','files','person','proof','accept']
where code='accepted';
update public.pto_workflow_steps set hint=case code
 when 'accounting' then 'Оригиналы у бухгалтерии. Отметьте принятие (кто принял, подтверждение) или верните с причиной.'
 when 'accepted' then 'Бухгалтерия приняла комплект. Закройте его.'
 else hint end
where code in ('accounting','accepted');

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

-- 4. Диспетчер команд.
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
  when payload->>'op'='set_theme' then pto_private.profile_command(request_id,payload)
  when payload->>'op'='set_estimate' then pto_private.estimate_command(request_id,payload)
  when payload->>'op' in ('workflow_advance','workflow_return') then pto_private.workflow_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
