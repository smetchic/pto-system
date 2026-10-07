-- Шаг 10: карточка контрагента — почтовый индекс для реквизитов договора и контактные лица.
-- * postal_code: индекс юридического адреса (в сведениях МНС его нет), вводится один раз вручную.
-- * pto_counterparty_contacts: люди и отделы контрагента (инженер ПТО по процентовкам, бухгалтерия…),
--   у каждого свой телефон и почта, вопросы и объекты. Правят начальник ПТО и инженеры; руководитель только читает.
-- Откат: supabase/rollback/20261008090000_counterparty_contacts.down.sql

alter table public.pto_counterparties add column postal_code text not null default '' check (postal_code ~ '^([0-9]{6})?$');

create table public.pto_counterparty_contacts (
 id uuid primary key default gen_random_uuid(),
 counterparty_id uuid not null references public.pto_counterparties(id) on delete restrict,
 name text not null check (length(trim(name)) between 1 and 200),
 position text not null default '',
 topics text not null default '',
 project_ids uuid[] not null default '{}',
 phone text not null default '',
 email text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index pto_counterparty_contacts_counterparty_idx on public.pto_counterparty_contacts(counterparty_id);
alter table public.pto_counterparty_contacts enable row level security;
revoke all on public.pto_counterparty_contacts from anon, authenticated;
grant select on public.pto_counterparty_contacts to authenticated;
create policy counterparty_contacts_read on public.pto_counterparty_contacts for select to authenticated using (pto_private.my_role() is not null);

-- Сохранение карточки: прежняя команда (20261005220232) плюс почтовый индекс.
create or replace function pto_private.counterparty_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  role_name text;
  op text := body->>'op';
  target uuid;
  result jsonb;
  prior pto_private.requests;
  unp_value text := trim(coalesce(body->>'unp',''));
  short_value text := trim(coalesce(body->>'short_name',''));
  full_value text := trim(coalesce(body->>'full_name',''));
  status_change_value text := coalesce(body->>'status_change_date',body->>'liquidation_date','');
  postal_value text := trim(coalesce(body->>'postal_code',''));
begin
  if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
  role_name := pto_private.my_role();
  if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
  if role_name not in ('head','engineer','admin') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;

  select * into prior from pto_private.requests where id=req;
  if found then
    if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
    return prior.result;
  end if;

  if unp_value !~ '^[0-9]{9}$' then raise exception 'УНП должен содержать 9 цифр'; end if;
  if length(short_value)=0 then raise exception 'Укажите краткое наименование'; end if;
  if length(full_value)=0 then raise exception 'Укажите полное наименование'; end if;
  if postal_value !~ '^([0-9]{6})?$' then raise exception 'Почтовый индекс — 6 цифр'; end if;

  if body ? 'roles' and exists (
    select 1
    from jsonb_array_elements_text(coalesce(body->'roles','[]'::jsonb)) r(value)
    where r.value not in ('customer','general_contractor','subcontractor','supplier','service_provider')
  ) then
    raise exception 'Неизвестная роль контрагента';
  end if;

  if op='create_counterparty' then
    insert into public.pto_counterparties(
      unp,short_name,full_name,address,registration_date,tax_office_code,tax_office_name,
      status_code,status_name,status_change_date,liquidation_info,phone,email,note,source,
      director_name,director_title,authority_basis,okpo,bank_account,bank_name,bank_bic,postal_code
    ) values (
      unp_value,short_value,full_value,trim(coalesce(body->>'address','')),
      nullif(body->>'registration_date','')::date,trim(coalesce(body->>'tax_office_code','')),
      trim(coalesce(body->>'tax_office_name','')),trim(coalesce(body->>'status_code','')),
      trim(coalesce(body->>'status_name','')),nullif(status_change_value,'')::date,
      trim(coalesce(body->>'liquidation_info','')),trim(coalesce(body->>'phone','')),
      trim(coalesce(body->>'email','')),trim(coalesce(body->>'note','')),
      trim(coalesce(nullif(body->>'source',''),'manual')),
      trim(coalesce(body->>'director_name','')),trim(coalesce(body->>'director_title','')),
      trim(coalesce(body->>'authority_basis','')),trim(coalesce(body->>'okpo','')),
      trim(coalesce(body->>'bank_account','')),trim(coalesce(body->>'bank_name','')),
      trim(coalesce(body->>'bank_bic','')),postal_value
    ) returning id into target;
  elsif op='update_counterparty' then
    target := (body->>'counterparty_id')::uuid;
    update public.pto_counterparties set
      unp=unp_value,
      short_name=short_value,
      full_name=full_value,
      address=trim(coalesce(body->>'address','')),
      registration_date=nullif(body->>'registration_date','')::date,
      tax_office_code=trim(coalesce(body->>'tax_office_code','')),
      tax_office_name=trim(coalesce(body->>'tax_office_name','')),
      status_code=trim(coalesce(body->>'status_code','')),
      status_name=trim(coalesce(body->>'status_name','')),
      status_change_date=nullif(status_change_value,'')::date,
      liquidation_info=trim(coalesce(body->>'liquidation_info','')),
      phone=trim(coalesce(body->>'phone','')),
      email=trim(coalesce(body->>'email','')),
      note=trim(coalesce(body->>'note','')),
      source=trim(coalesce(nullif(body->>'source',''),source)),
      director_name=trim(coalesce(body->>'director_name','')),
      director_title=trim(coalesce(body->>'director_title','')),
      authority_basis=trim(coalesce(body->>'authority_basis','')),
      okpo=trim(coalesce(body->>'okpo','')),
      bank_account=trim(coalesce(body->>'bank_account','')),
      bank_name=trim(coalesce(body->>'bank_name','')),
      bank_bic=trim(coalesce(body->>'bank_bic','')),
      postal_code=postal_value,
      updated_at=now()
    where id=target;
    if not found then raise exception 'Контрагент не найден'; end if;
  else
    raise exception 'Неизвестная операция';
  end if;

  if body ? 'roles' then
    delete from public.pto_counterparty_roles where counterparty_id=target;
    insert into public.pto_counterparty_roles(counterparty_id,role)
    select target,r.value
    from jsonb_array_elements_text(coalesce(body->'roles','[]'::jsonb)) r(value)
    on conflict do nothing;
  end if;

  -- Справочник общий для всех объектов: событие без объекта видно начальнику ПТО и администратору.
  insert into public.pto_events(project_id,actor,action,detail)
  values(null,who,op,body || jsonb_build_object('counterparty_id',target));

  result := jsonb_build_object('counterparty_id',target);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;


create function pto_private.counterparty_contact_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op'; prior pto_private.requests; result jsonb;
 target uuid; party uuid; projects uuid[];
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 role_name:=pto_private.my_role();
 if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;

 if op='save_counterparty_contact' then
  if length(trim(coalesce(body->>'name','')))=0 then raise exception 'Укажите ФИО или отдел'; end if;
  select coalesce(array_agg(value::uuid),'{}') into projects from jsonb_array_elements_text(coalesce(body->'project_ids','[]'::jsonb));
  if exists(select 1 from unnest(projects) p where not exists(select 1 from public.pto_projects x where x.id=p)) then raise exception 'Объект не найден'; end if;
  if nullif(body->>'contact_id','') is null then
   party:=(body->>'counterparty_id')::uuid;
   if not exists(select 1 from public.pto_counterparties where id=party) then raise exception 'Контрагент не найден'; end if;
   insert into public.pto_counterparty_contacts(counterparty_id,name,position,topics,project_ids,phone,email)
   values(party,trim(body->>'name'),trim(coalesce(body->>'position','')),trim(coalesce(body->>'topics','')),projects,trim(coalesce(body->>'phone','')),trim(coalesce(body->>'email','')))
   returning id into target;
  else
   target:=(body->>'contact_id')::uuid;
   update public.pto_counterparty_contacts set name=trim(body->>'name'),position=trim(coalesce(body->>'position','')),topics=trim(coalesce(body->>'topics','')),
    project_ids=projects,phone=trim(coalesce(body->>'phone','')),email=trim(coalesce(body->>'email','')),updated_at=now()
   where id=target returning counterparty_id into party;
   if not found then raise exception 'Контакт не найден'; end if;
  end if;
 elsif op='delete_counterparty_contact' then
  target:=(body->>'contact_id')::uuid;
  delete from public.pto_counterparty_contacts where id=target returning counterparty_id into party;
  if not found then raise exception 'Контакт не найден'; end if;
 else
  raise exception 'Неизвестная операция';
 end if;
 insert into public.pto_events(project_id,actor,action,detail) values(null,who,op,body||jsonb_build_object('counterparty_id',party,'contact_id',target));
 result:=jsonb_build_object('contact_id',target);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.counterparty_contact_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.counterparty_contact_command(uuid,jsonb) to authenticated;

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
  when payload->>'op'='set_theme' then pto_private.profile_command(request_id,payload)
  when payload->>'op'='set_estimate' then pto_private.estimate_command(request_id,payload)
  when payload->>'op' in ('workflow_advance','workflow_return') then pto_private.workflow_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
