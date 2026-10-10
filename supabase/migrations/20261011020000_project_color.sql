-- Цвет объекта выбирает начальник ПТО в карточке объекта («Ещё → Объекты»), тред «Вкладка «Месяц» в объекте», 10.10.2026.
-- Пусто — цвет по порядку объектов, как раньше. Палитра без красного и оранжевого задаётся в интерфейсе (src/conveyor.js).
-- Откат: supabase/rollback/20261011020000_project_color.down.sql

alter table public.pto_projects add column color text check (color ~ '^#[0-9a-f]{6}$');

create or replace function pto_private.project_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; prior pto_private.requests; result jsonb; p public.pto_projects;
 v_name text:=trim(coalesce(body->>'name',''));
 v_full text:=trim(coalesce(nullif(trim(body->>'full_name'),''),body->>'name',''));
 v_address text:=trim(coalesce(body->>'address',''));
 v_color text:=nullif(lower(trim(coalesce(body->>'color',''))),'');
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
 if v_color is not null and v_color !~ '^#[0-9a-f]{6}$' then raise exception 'Неверный цвет объекта'; end if;
 if exists(select 1 from public.pto_projects x where x.id<>p.id and lower(trim(x.name))=lower(v_name)) then
  raise exception 'Объект с таким названием уже есть';
 end if;
 update public.pto_projects set name=v_name,full_name=v_full,address=v_address,color=case when body ? 'color' then v_color else p.color end where id=p.id;
 insert into public.pto_events(project_id,actor,action,detail) values(p.id,who,'update_project',
  jsonb_build_object('before',jsonb_build_object('name',p.name,'full_name',p.full_name,'address',p.address,'color',p.color),
   'after',jsonb_build_object('name',v_name,'full_name',v_full,'address',v_address,'color',case when body ? 'color' then v_color else p.color end)));
 result:=jsonb_build_object('project_id',p.id);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.project_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.project_command(uuid,jsonb) to authenticated;

