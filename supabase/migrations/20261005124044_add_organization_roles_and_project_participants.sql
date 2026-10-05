create table if not exists public.pto_organization (
  id smallint primary key default 1 check (id = 1),
  unp text not null unique check (unp ~ '^[0-9]{9}$'),
  short_name text not null check (length(trim(short_name)) between 1 and 200),
  full_name text not null check (length(trim(full_name)) between 1 and 500),
  address text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.pto_organization(id,unp,short_name,full_name,address)
values (
  1,
  '191426884',
  'Государственное предприятие "СУ № 22"',
  'Коммунальное дочернее унитарное предприятие "Строительное управление № 22"',
  'Республика Беларусь, Заводской район, г. Минск, пр. Партизанский, дом 144, каб. 42'
)
on conflict (id) do update set
  unp=excluded.unp,
  short_name=excluded.short_name,
  full_name=excluded.full_name,
  address=excluded.address,
  updated_at=now();

alter table public.pto_organization enable row level security;
revoke all on public.pto_organization from anon, authenticated;
grant select on public.pto_organization to authenticated;
drop policy if exists organization_read on public.pto_organization;
create policy organization_read on public.pto_organization
for select to authenticated
using (pto_private.my_role() is not null);

create table if not exists public.pto_counterparty_roles (
  counterparty_id uuid not null references public.pto_counterparties(id) on delete cascade,
  role text not null check (role in ('customer','general_contractor','subcontractor','supplier','service_provider')),
  created_at timestamptz not null default now(),
  primary key(counterparty_id,role)
);
create index if not exists pto_counterparty_roles_role_idx on public.pto_counterparty_roles(role,counterparty_id);

alter table public.pto_counterparty_roles enable row level security;
revoke all on public.pto_counterparty_roles from anon, authenticated;
grant select on public.pto_counterparty_roles to authenticated;
drop policy if exists counterparty_roles_read on public.pto_counterparty_roles;
create policy counterparty_roles_read on public.pto_counterparty_roles
for select to authenticated
using (pto_private.my_role() is not null);

create table if not exists public.pto_project_participants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pto_projects(id) on delete cascade,
  counterparty_id uuid not null references public.pto_counterparties(id) on delete cascade,
  role text not null check (role in ('customer','general_contractor','subcontractor','supplier','service_provider')),
  created_at timestamptz not null default now(),
  unique(project_id,counterparty_id,role)
);
create index if not exists pto_project_participants_project_role_idx on public.pto_project_participants(project_id,role);
create index if not exists pto_project_participants_counterparty_idx on public.pto_project_participants(counterparty_id);

alter table public.pto_project_participants enable row level security;
revoke all on public.pto_project_participants from anon, authenticated;
grant select on public.pto_project_participants to authenticated;
drop policy if exists project_participants_read on public.pto_project_participants;
create policy project_participants_read on public.pto_project_participants
for select to authenticated
using (coalesce(pto_private.can_access(project_id),false));

alter table public.pto_contracts
  add column if not exists contract_date date,
  add column if not exists subject text not null default '',
  add column if not exists our_role text not null default 'contractor',
  add column if not exists counterparty_role text not null default 'customer';

alter table public.pto_contracts drop constraint if exists pto_contracts_subject_check;
alter table public.pto_contracts add constraint pto_contracts_subject_check check (length(subject) <= 1000);
alter table public.pto_contracts drop constraint if exists pto_contracts_our_role_check;
alter table public.pto_contracts add constraint pto_contracts_our_role_check check (our_role in ('contractor','subcontractor','customer','buyer','service_customer'));
alter table public.pto_contracts drop constraint if exists pto_contracts_counterparty_role_check;
alter table public.pto_contracts add constraint pto_contracts_counterparty_role_check check (counterparty_role in ('customer','general_contractor','subcontractor','supplier','service_provider'));

update public.pto_contracts
set our_role = case when direction='incoming' then 'customer' else 'contractor' end,
    counterparty_role = case when direction='incoming' then 'subcontractor' else 'customer' end
where counterparty_id is not null
  and (our_role is null or counterparty_role is null);

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
      status_code,status_name,status_change_date,liquidation_info,phone,email,note,source
    ) values (
      unp_value,short_value,full_value,trim(coalesce(body->>'address','')),
      nullif(body->>'registration_date','')::date,trim(coalesce(body->>'tax_office_code','')),
      trim(coalesce(body->>'tax_office_name','')),trim(coalesce(body->>'status_code','')),
      trim(coalesce(body->>'status_name','')),nullif(status_change_value,'')::date,
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
      status_change_date=nullif(status_change_value,'')::date,
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

  if body ? 'roles' then
    delete from public.pto_counterparty_roles where counterparty_id=target;
    insert into public.pto_counterparty_roles(counterparty_id,role)
    select target,r.value
    from jsonb_array_elements_text(coalesce(body->'roles','[]'::jsonb)) r(value)
    on conflict do nothing;
  end if;

  result := jsonb_build_object('counterparty_id',target);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;

create or replace function pto_private.project_participant_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  role_name text;
  op text := body->>'op';
  project uuid := (body->>'project_id')::uuid;
  cp uuid;
  participant uuid;
  participant_role text := trim(coalesce(body->>'role',''));
  result jsonb;
  prior pto_private.requests;
begin
  if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
  role_name := pto_private.my_role();
  if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
  if role_name not in ('head','engineer','admin') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  if not coalesce(pto_private.can_access(project),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;

  select * into prior from pto_private.requests where id=req;
  if found then
    if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
    return prior.result;
  end if;

  if op='add_project_participant' then
    cp := (body->>'counterparty_id')::uuid;
    if participant_role not in ('customer','general_contractor','subcontractor','supplier','service_provider') then
      raise exception 'Неизвестная роль участника объекта';
    end if;
    if not exists(select 1 from public.pto_counterparties where id=cp) then raise exception 'Контрагент не найден'; end if;

    insert into public.pto_project_participants(project_id,counterparty_id,role)
    values(project,cp,participant_role)
    on conflict(project_id,counterparty_id,role) do update set role=excluded.role
    returning id into participant;

    insert into public.pto_counterparty_roles(counterparty_id,role)
    values(cp,participant_role)
    on conflict do nothing;

    insert into public.pto_events(project_id,actor,action,detail)
    values(project,who,'add_project_participant',body);
  elsif op='remove_project_participant' then
    participant := (body->>'participant_id')::uuid;
    delete from public.pto_project_participants
    where id=participant and project_id=project
    returning counterparty_id into cp;
    if not found then raise exception 'Участник объекта не найден'; end if;

    insert into public.pto_events(project_id,actor,action,detail)
    values(project,who,'remove_project_participant',body);
  else
    raise exception 'Неизвестная операция';
  end if;

  result := jsonb_build_object('project_id',project,'participant_id',participant,'counterparty_id',cp);
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
  our_role_value text;
  cp_role_value text;
  direction_value text;
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

  our_role_value := coalesce(nullif(body->>'our_role',''),case when body->>'direction'='incoming' then 'customer' else 'contractor' end);
  cp_role_value := coalesce(nullif(body->>'counterparty_role',''),case when body->>'direction'='incoming' then 'subcontractor' else 'customer' end);

  if not (
    (our_role_value='contractor' and cp_role_value='customer') or
    (our_role_value='subcontractor' and cp_role_value in ('general_contractor','customer')) or
    (our_role_value='customer' and cp_role_value='subcontractor') or
    (our_role_value='buyer' and cp_role_value='supplier') or
    (our_role_value='service_customer' and cp_role_value='service_provider')
  ) then
    raise exception 'Несовместимые роли сторон договора';
  end if;

  direction_value := case when cp_role_value in ('customer','general_contractor') then 'outgoing' else 'incoming' end;

  insert into public.pto_contracts(
    project_id,number,party,direction,counterparty_id,contract_date,subject,our_role,counterparty_role
  ) values(
    project,trim(body->>'number'),cp_name,direction_value,cp,
    nullif(body->>'contract_date','')::date,trim(coalesce(body->>'subject','')),
    our_role_value,cp_role_value
  );

  if cp is not null then
    insert into public.pto_counterparty_roles(counterparty_id,role)
    values(cp,cp_role_value)
    on conflict do nothing;

    if cp_role_value in ('customer','general_contractor','subcontractor') then
      insert into public.pto_project_participants(project_id,counterparty_id,role)
      values(project,cp,cp_role_value)
      on conflict(project_id,counterparty_id,role) do nothing;
    end if;
  end if;

  insert into public.pto_events(project_id,actor,action,detail)
  values(project,who,'create_contract',body || jsonb_build_object('direction',direction_value));

  result := jsonb_build_object('project_id',project,'counterparty_id',cp,'our_role',our_role_value,'counterparty_role',cp_role_value);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select case
    when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
    when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
    when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
    when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
    else pto_private.command(request_id,payload)
  end;
$$;

revoke all on function pto_private.counterparty_command(uuid,jsonb) from public,anon,authenticated;
revoke all on function pto_private.project_participant_command(uuid,jsonb) from public,anon,authenticated;
revoke all on function pto_private.create_contract(uuid,jsonb) from public,anon,authenticated;
grant execute on function pto_private.counterparty_command(uuid,jsonb), pto_private.project_participant_command(uuid,jsonb), pto_private.create_contract(uuid,jsonb) to authenticated;
revoke all on function public.pto_command(uuid,jsonb) from public,anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
