-- Прошлые месяцы сразу на поздний шаг «Подписания» (просьба пользователя 11.10.2026: занести в базу прошлые периоды).
-- * Команда workflow_jump: начальник ПТО ставит комплект прошлого месяца сразу на «На проверке», «Проверено» или «В бухгалтерии».
-- * Проверки шагов (технадзор субподрядчиков, справка С-3а, письмо, сканы) для прошлого месяца не требуются;
--   нужны только документы с суммами: акты С-2 (С-29 для маршрута С-29) и отсутствие открытых замечаний.
-- * Каждый пропущенный шаг пишется обычным переходом с той же датой и пометкой, поэтому даты шагов, история
--   и «Отменить переход» работают как обычно. «В бухгалтерии» фиксирует принятые версии, как обычная передача.
-- Откат: supabase/rollback/20261011170000_history_jump.down.sql

create or replace function pto_private.workflow_jump_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; prior pto_private.requests; result jsonb;
 wf public.pto_workflows; per public.pto_periods; cur public.pto_workflow_steps; nxt public.pto_workflow_steps; st public.pto_workflow_steps;
 target text:=trim(coalesce(body->>'to_step','')); date_value date; note_value text;
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
 if role_name<>'head' then raise exception 'Прошлый месяц сразу на поздний шаг вносит начальник ПТО' using errcode='42501'; end if;
 date_value:=coalesce(nullif(body->>'date','')::date,current_date);
 if date_value>current_date then raise exception 'Дата не может быть позже сегодняшней'; end if;
 note_value:='Прошлый месяц, внесено сразу'||coalesce(nullif(': '||trim(coalesce(body->>'note','')),': '),'');

 select * into wf from public.pto_workflows where id=(body->>'workflow_id')::uuid for update;
 if not found then raise exception 'Комплект не найден'; end if;
 if not coalesce(pto_private.can_access(wf.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 select * into per from public.pto_periods where id=wf.period_id for update;
 if per.status<>'open' then raise exception 'Период закрыт'; end if;
 if nullif(body->>'expected_revision','') is not null and (body->>'expected_revision')::integer is distinct from per.revision then
  raise exception 'Данные уже изменились. Обновите страницу' using errcode='40001';
 end if;
 if per.month>=date_trunc('month',current_date)::date then
  raise exception 'Сразу на поздний шаг вносятся только прошлые месяцы; текущий месяц идёт по шагам';
 end if;
 select * into cur from public.pto_workflow_steps where template_code=wf.template_code and code=wf.step_code;
 select * into nxt from public.pto_workflow_steps where template_code=wf.template_code and code=target;
 if not found or target not in ('check','signed','accepted') then raise exception 'Выберите шаг: на проверке, проверено или в бухгалтерии'; end if;
 if nxt.ordinal<=cur.ordinal then raise exception 'Комплект уже на этом шаге или дальше'; end if;
 if exists(select 1 from public.pto_workflow_events n where n.workflow_id=wf.id and n.kind='note'
  and not exists(select 1 from public.pto_workflow_events o where o.ref_event=n.id and o.kind='note_off')) then
  raise exception 'Есть открытое замечание: снимите его, когда исправят';
 end if;
 if not exists(select 1 from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
  where wd.workflow_id=wf.id and d.kind=any(case when wf.template_code='c29' then array['c29'] else array['c2a','c2b'] end)) then
  raise exception '%',case when wf.template_code='c29' then 'В комплекте нет С-29' else 'В комплекте нет актов С-2: сначала внесите акты с суммами' end;
 end if;

 -- Пропущенные шаги — обычные переходы с одной датой и пометкой.
 for st in select * from public.pto_workflow_steps where template_code=wf.template_code and ordinal>cur.ordinal and ordinal<=nxt.ordinal order by ordinal loop
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,event_date,note)
  values(wf.id,'advance',cur.code,st.code,who,date_value,note_value);
  cur:=st;
 end loop;
 if 'accept'=any(nxt.requires) then
  update public.pto_documents d set accepted_version=d.current_version
  from public.pto_workflow_documents wd where wd.workflow_id=wf.id and wd.document_id=d.id;
 end if;
 update public.pto_workflows set step_code=nxt.code,updated_at=now() where id=wf.id;

 update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id;
 insert into public.pto_events(project_id,period_id,actor,action,detail)
 values(wf.project_id,wf.period_id,who,'workflow_jump',body || jsonb_build_object('to',nxt.code,'template',wf.template_code));
 result:=jsonb_build_object('workflow_id',wf.id,'project_id',wf.project_id,'period_id',wf.period_id,'step',nxt.code);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.workflow_jump_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.workflow_jump_command(uuid,jsonb) to authenticated;

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
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
  when payload->>'op' in ('workflow_advance','workflow_return','workflow_undo','workflow_note','workflow_note_off','workflow_received',
   'workflow_start','workflow_skip','workflow_unskip') then pto_private.workflow_command(request_id,payload)
  when payload->>'op'='workflow_jump' then pto_private.workflow_jump_command(request_id,payload)
  when payload->>'op' in ('set_sub_month','set_month_marks','set_document_mark','check_file') then pto_private.month_command(request_id,payload)
  when payload->>'op'='set_contract_part' then pto_private.part_command(request_id,payload)
  when payload->>'op' in ('import_contracts','set_contract_checked') then pto_private.contract_import_command(request_id,payload)
  when payload->>'op'='delete_contract' then pto_private.contract_delete_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
