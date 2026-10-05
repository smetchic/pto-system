create table if not exists public.pto_counterparties (
  id uuid primary key default gen_random_uuid(),
  unp text not null unique check (unp ~ '^[0-9]{9}$'),
  short_name text not null check (length(trim(short_name)) between 1 and 200),
  full_name text not null check (length(trim(full_name)) between 1 and 500),
  address text not null default '',
  registration_date date,
  tax_office_code text not null default '',
  tax_office_name text not null default '',
  status_code text not null default '',
  status_name text not null default '',
  liquidation_date date,
  liquidation_info text not null default '',
  phone text not null default '',
  email text not null default '',
  note text not null default '',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pto_counterparties enable row level security;
revoke all on public.pto_counterparties from anon, authenticated;
grant select on public.pto_counterparties to authenticated;
create policy counterparty_read on public.pto_counterparties
for select to authenticated
using (pto_private.my_role() is not null);

alter table public.pto_contracts
  add column if not exists counterparty_id uuid references public.pto_counterparties(id);
create index if not exists pto_contracts_counterparty_id_idx on public.pto_contracts(counterparty_id);

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

  if op='create_counterparty' then
    insert into public.pto_counterparties(
      unp,short_name,full_name,address,registration_date,tax_office_code,tax_office_name,
      status_code,status_name,liquidation_date,liquidation_info,phone,email,note,source
    ) values (
      unp_value,short_value,full_value,trim(coalesce(body->>'address','')),
      nullif(body->>'registration_date','')::date,trim(coalesce(body->>'tax_office_code','')),
      trim(coalesce(body->>'tax_office_name','')),trim(coalesce(body->>'status_code','')),
      trim(coalesce(body->>'status_name','')),nullif(body->>'liquidation_date','')::date,
      trim(coalesce(body->>'liquidation_info','')),trim(coalesce(body->>'phone','')),
      trim(coalesce(body->>'email','')),trim(coalesce(body->>'note','')),
      trim(coalesce(nullif(body->>'source',''),'manual'))
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
      liquidation_date=nullif(body->>'liquidation_date','')::date,
      liquidation_info=trim(coalesce(body->>'liquidation_info','')),
      phone=trim(coalesce(body->>'phone','')),
      email=trim(coalesce(body->>'email','')),
      note=trim(coalesce(body->>'note','')),
      source=trim(coalesce(nullif(body->>'source',''),source)),
      updated_at=now()
    where id=target;
    if not found then raise exception 'Контрагент не найден'; end if;
    update public.pto_contracts set party=short_value where counterparty_id=target;
  else
    raise exception 'Неизвестная операция';
  end if;

  result := jsonb_build_object('counterparty_id',target);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;

create or replace function pto_private.create_contract(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  role_name text;
  project uuid := (body->>'project_id')::uuid;
  cp uuid;
  cp_name text;
  result jsonb;
  prior pto_private.requests;
begin
  if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
  role_name := pto_private.my_role();
  if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
  if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  if not coalesce(pto_private.can_access(project),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;

  select * into prior from pto_private.requests where id=req;
  if found then
    if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
    return prior.result;
  end if;

  if nullif(body->>'counterparty_id','') is not null then
    cp := (body->>'counterparty_id')::uuid;
    select short_name into cp_name from public.pto_counterparties where id=cp;
    if cp_name is null then raise exception 'Контрагент не найден'; end if;
  else
    cp_name := trim(coalesce(body->>'party',''));
    if length(cp_name)=0 then raise exception 'Выберите контрагента'; end if;
  end if;

  insert into public.pto_contracts(project_id,number,party,direction,counterparty_id)
  values(project,trim(body->>'number'),cp_name,body->>'direction',cp);

  insert into public.pto_events(project_id,actor,action,detail)
  values(project,who,'create_contract',body);

  result := jsonb_build_object('project_id',project,'counterparty_id',cp);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select case
    when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
    when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
    when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
    else pto_private.command(request_id,payload)
  end;
$$;

revoke all on function pto_private.counterparty_command(uuid,jsonb) from public,anon,authenticated;
revoke all on function pto_private.create_contract(uuid,jsonb) from public,anon,authenticated;
grant execute on function pto_private.counterparty_command(uuid,jsonb), pto_private.create_contract(uuid,jsonb) to authenticated;
revoke all on function public.pto_command(uuid,jsonb) from public,anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
