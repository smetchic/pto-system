-- Размер текста в профиле: для тех, кому плохо видно мелкий шрифт (решение пользователя от 08.10.2026).
-- Хранится, как тема: 100 (обычный), 115 (крупнее), 130 (крупный) процентов; меняет только сам пользователь.
-- Откат: supabase/rollback/20261008180000_profile_text_scale.down.sql

alter table public.pto_profiles add column text_scale smallint not null default 100 check (text_scale in (100,115,130));

create or replace function pto_private.profile_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); result jsonb; prior pto_private.requests; scale_value smallint;
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 if pto_private.my_role() is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 -- Только собственные настройки отображения: событие в журнал не пишется.
 if body->>'op'='set_theme' then
  if coalesce(body->>'theme','') not in ('light','dark','system') then raise exception 'Неизвестная тема оформления'; end if;
  update public.pto_profiles set theme=body->>'theme' where id=who;
  result:=jsonb_build_object('theme',body->>'theme');
 elsif body->>'op'='set_text_scale' then
  if coalesce(body->>'text_scale','') not in ('100','115','130') then raise exception 'Неизвестный размер текста'; end if;
  scale_value:=(body->>'text_scale')::smallint;
  update public.pto_profiles set text_scale=scale_value where id=who;
  result:=jsonb_build_object('text_scale',scale_value);
 else
  raise exception 'Неизвестная операция';
 end if;
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.profile_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.profile_command(uuid,jsonb) to authenticated;

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
