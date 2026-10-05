create or replace function pto_private.create_project(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  role_name text;
  project uuid;
  result jsonb;
  prior pto_private.requests;
  short_name text := trim(coalesce(body->>'name',''));
  official_name text := trim(coalesce(nullif(body->>'full_name',''), body->>'name',''));
  project_address text := trim(coalesce(body->>'address',''));
begin
  if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
  role_name := pto_private.my_role();
  if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
  if role_name not in ('head','admin') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
  select * into prior from pto_private.requests where id=req;
  if found then
    if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
    return prior.result;
  end if;
  if length(short_name) not between 1 and 120 then raise exception 'Краткое название должно содержать от 1 до 120 символов'; end if;
  if length(official_name) not between 1 and 500 then raise exception 'Укажите полное наименование объекта'; end if;
  insert into public.pto_projects(name,full_name,address)
  values(short_name,official_name,project_address)
  returning id into project;
  insert into public.pto_events(project_id,actor,action,detail)
  values(project,who,'create_project',body);
  result := jsonb_build_object('project_id',project,'period_id',null,'document_id',null,'version_id',null);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;
