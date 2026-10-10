-- Карточка объекта в «Ещё → Объекты»: правка названия, полного наименования и адреса (тред «Вкладка «Месяц» в объекте», 10.10.2026).
-- Правит начальник ПТО (и администратор), как и создаёт объекты. Событие update_project в журнале хранит прежние и новые значения.
-- Откат: supabase/rollback/20261011010000_update_project.down.sql

create or replace function pto_private.project_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; prior pto_private.requests; result jsonb; p public.pto_projects;
 v_name text:=trim(coalesce(body->>'name',''));
 v_full text:=trim(coalesce(nullif(trim(body->>'full_name'),''),body->>'name',''));
 v_address text:=trim(coalesce(body->>'address',''));
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 role_name:=pto_private.my_role();
 if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if role_name not in ('head','admin') then raise exception 'Изменять объект может начальник ПТО' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 if body->>'op'<>'update_project' then raise exception 'Неизвестная команда'; end if;
 select * into p from public.pto_projects where id=(body->>'project_id')::uuid for update;
 if not found then raise exception 'Объект не найден'; end if;
 if length(v_name) not between 1 and 120 then raise exception 'Краткое название должно содержать от 1 до 120 символов'; end if;
 if length(v_full) not between 1 and 500 then raise exception 'Укажите полное наименование объекта'; end if;
 if exists(select 1 from public.pto_projects x where x.id<>p.id and lower(trim(x.name))=lower(v_name)) then
  raise exception 'Объект с таким названием уже есть';
 end if;
 update public.pto_projects set name=v_name,full_name=v_full,address=v_address where id=p.id;
 insert into public.pto_events(project_id,actor,action,detail) values(p.id,who,'update_project',
  jsonb_build_object('before',jsonb_build_object('name',p.name,'full_name',p.full_name,'address',p.address),
   'after',jsonb_build_object('name',v_name,'full_name',v_full,'address',v_address)));
 result:=jsonb_build_object('project_id',p.id);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.project_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.project_command(uuid,jsonb) to authenticated;

-- Диспетчер: прежний (20261011000000) + правка объекта.
create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='update_project' then pto_private.project_command(request_id,payload)
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
  when payload->>'op' in ('import_contracts','set_contract_checked') then pto_private.contract_import_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
