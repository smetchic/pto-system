create table if not exists public.pto_processes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pto_projects(id) on delete cascade,
  period_id uuid not null references public.pto_periods(id) on delete cascade,
  contract_id uuid not null references public.pto_contracts(id) on delete cascade,
  process_type text not null default 'progress_claim' check (process_type in ('progress_claim')),
  bucket text not null default 'pto' check (bucket in ('pto','site','review','external','accounting','closed')),
  step_label text not null default 'Подготовка ПТО',
  due_date date,
  responsible_user uuid references public.pto_profiles(id),
  attention_document_id uuid references public.pto_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_id,contract_id,process_type)
);
create index if not exists pto_processes_project_period_idx on public.pto_processes(project_id,period_id);
create index if not exists pto_processes_bucket_idx on public.pto_processes(bucket,period_id);
create index if not exists pto_processes_contract_idx on public.pto_processes(contract_id);

create table if not exists public.pto_process_documents (
  process_id uuid not null references public.pto_processes(id) on delete cascade,
  document_id uuid not null references public.pto_documents(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key(process_id,document_id),
  unique(document_id)
);
create index if not exists pto_process_documents_document_idx on public.pto_process_documents(document_id);

create table if not exists public.pto_process_events (
  id bigint generated always as identity primary key,
  process_id uuid not null references public.pto_processes(id) on delete cascade,
  actor uuid not null references public.pto_profiles(id),
  from_bucket text,
  to_bucket text not null,
  document_id uuid references public.pto_documents(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists pto_process_events_process_created_idx on public.pto_process_events(process_id,created_at desc);

alter table public.pto_processes enable row level security;
alter table public.pto_process_documents enable row level security;
alter table public.pto_process_events enable row level security;

revoke all on public.pto_processes, public.pto_process_documents, public.pto_process_events from anon, authenticated;
grant select on public.pto_processes, public.pto_process_documents, public.pto_process_events to authenticated;

drop policy if exists processes_read on public.pto_processes;
create policy processes_read on public.pto_processes
for select to authenticated
using (coalesce(pto_private.can_access(project_id),false));

drop policy if exists process_documents_read on public.pto_process_documents;
create policy process_documents_read on public.pto_process_documents
for select to authenticated
using (exists (
  select 1 from public.pto_processes p
  where p.id=process_id and coalesce(pto_private.can_access(p.project_id),false)
));

drop policy if exists process_events_read on public.pto_process_events;
create policy process_events_read on public.pto_process_events
for select to authenticated
using (exists (
  select 1 from public.pto_processes p
  where p.id=process_id and coalesce(pto_private.can_access(p.project_id),false)
));

create or replace function pto_private.auto_link_progress_process() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  process_id_value uuid;
  contract_direction text;
  actor_value uuid:=auth.uid();
begin
  if new.kind not in ('c2a','c2b','c3a') then return new; end if;
  select direction into contract_direction from public.pto_contracts where id=new.contract_id;
  if contract_direction is distinct from 'outgoing' then return new; end if;

  insert into public.pto_processes(project_id,period_id,contract_id,process_type,bucket,step_label,responsible_user)
  values(new.project_id,new.period_id,new.contract_id,'progress_claim','pto','Подготовка ПТО',actor_value)
  on conflict(period_id,contract_id,process_type) do update set updated_at=now()
  returning id into process_id_value;

  insert into public.pto_process_documents(process_id,document_id)
  values(process_id_value,new.id)
  on conflict(document_id) do nothing;
  return new;
end $$;

revoke all on function pto_private.auto_link_progress_process() from public,anon,authenticated;

drop trigger if exists pto_documents_auto_progress_process on public.pto_documents;
create trigger pto_documents_auto_progress_process
after insert on public.pto_documents
for each row execute function pto_private.auto_link_progress_process();

insert into public.pto_processes(project_id,period_id,contract_id,process_type,bucket,step_label)
select distinct d.project_id,d.period_id,d.contract_id,'progress_claim','pto','Подготовка ПТО'
from public.pto_documents d
join public.pto_contracts c on c.id=d.contract_id
where d.kind in ('c2a','c2b','c3a') and c.direction='outgoing'
on conflict(period_id,contract_id,process_type) do nothing;

insert into public.pto_process_documents(process_id,document_id)
select p.id,d.id
from public.pto_documents d
join public.pto_contracts c on c.id=d.contract_id and c.direction='outgoing'
join public.pto_processes p on p.period_id=d.period_id and p.contract_id=d.contract_id and p.process_type='progress_claim'
where d.kind in ('c2a','c2b','c3a')
on conflict(document_id) do nothing;

create or replace function pto_private.process_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid:=auth.uid();
  role_name text;
  op text:=body->>'op';
  process public.pto_processes;
  per public.pto_periods;
  target_bucket text;
  prior pto_private.requests;
  result jsonb;
  from_bucket text;
  attention uuid;
  act_count integer;
  c3_count integer;
  acts_total numeric(16,2);
  c3_total numeric(16,2);
begin
  if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(722023);
  role_name:=pto_private.my_role();
  if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
  if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
  select * into prior from pto_private.requests where id=req;
  if found then
    if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
    return prior.result;
  end if;

  if op='create_process' then
    select p.* into per from public.pto_periods p where p.id=(body->>'period_id')::uuid for update;
    if not found then raise exception 'Период не найден'; end if;
    if per.status<>'open' then raise exception 'Период закрыт'; end if;
    if not coalesce(pto_private.can_access(per.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
    if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
    insert into public.pto_processes(project_id,period_id,contract_id,process_type,bucket,step_label,responsible_user,due_date)
    select per.project_id,per.id,c.id,'progress_claim','pto','Подготовка ПТО',who,nullif(body->>'due_date','')::date
    from public.pto_contracts c
    where c.id=(body->>'contract_id')::uuid and c.project_id=per.project_id and c.direction='outgoing'
    on conflict(period_id,contract_id,process_type) do update set due_date=coalesce(excluded.due_date,public.pto_processes.due_date),updated_at=now()
    returning * into process;
    if process.id is null then raise exception 'Исходящий договор не найден'; end if;
  elsif op='transition_process' then
    select * into process from public.pto_processes where id=(body->>'process_id')::uuid for update;
    if not found then raise exception 'Процесс не найден'; end if;
    select * into per from public.pto_periods where id=process.period_id for update;
    if not coalesce(pto_private.can_access(process.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
    if per.status<>'open' then raise exception 'Период закрыт'; end if;
    if nullif(body->>'expected_revision','') is not null and (body->>'expected_revision')::integer is distinct from per.revision then
      raise exception 'Данные уже изменились. Обновите страницу' using errcode='40001';
    end if;
    target_bucket:=body->>'bucket';
    if target_bucket not in ('pto','site','review','external','accounting','closed') then raise exception 'Неизвестный этап'; end if;
    if process.bucket='closed' then raise exception 'Закрытый процесс нельзя перемещать'; end if;
    if not (
      (process.bucket='pto' and target_bucket in ('site','review','external')) or
      (process.bucket='site' and target_bucket in ('pto','review','external')) or
      (process.bucket='review' and target_bucket in ('pto','external')) or
      (process.bucket='external' and target_bucket in ('pto','accounting')) or
      (process.bucket='accounting' and target_bucket in ('pto','closed'))
    ) then raise exception 'Недопустимый переход процесса'; end if;

    if target_bucket='closed' then
      if role_name not in ('head','accountant') then raise exception 'Закрытие доступно начальнику ПТО или бухгалтерии' using errcode='42501'; end if;
    elsif role_name not in ('head','engineer') then
      raise exception 'Недостаточно прав' using errcode='42501';
    end if;

    select count(*) filter(where d.kind in ('c2a','c2b')),
           count(*) filter(where d.kind='c3a'),
           coalesce(sum(v.amount) filter(where d.kind in ('c2a','c2b')),0),
           coalesce(sum(v.amount) filter(where d.kind='c3a'),0)
    into act_count,c3_count,acts_total,c3_total
    from public.pto_process_documents pd
    join public.pto_documents d on d.id=pd.document_id
    left join public.pto_versions v on v.id=d.current_version
    where pd.process_id=process.id;

    if target_bucket in ('external','accounting','closed') and (act_count=0 or c3_count<>1) then
      raise exception 'Для передачи нужен комплект: акты и одна С-3а';
    end if;
    if target_bucket in ('accounting','closed') and acts_total is distinct from c3_total then
      raise exception 'Сумма актов не совпадает с С-3а';
    end if;
    if target_bucket='accounting' and exists(
      select 1 from public.pto_process_documents pd join public.pto_documents d on d.id=pd.document_id
      where pd.process_id=process.id and d.status not in ('signed','accepted')
    ) then raise exception 'Не все документы подписаны'; end if;
    if target_bucket='closed' and exists(
      select 1 from public.pto_process_documents pd join public.pto_documents d on d.id=pd.document_id
      where pd.process_id=process.id and (d.status<>'accepted' or d.current_version is distinct from d.accepted_version)
    ) then raise exception 'Не все документы приняты бухгалтерией'; end if;

    attention:=nullif(body->>'document_id','')::uuid;
    if attention is not null and not exists(select 1 from public.pto_process_documents where process_id=process.id and document_id=attention) then
      raise exception 'Документ не входит в комплект';
    end if;
    if target_bucket='pto' and length(trim(coalesce(body->>'note','')))<3 then raise exception 'Укажите причину возврата'; end if;

    from_bucket:=process.bucket;
    update public.pto_processes set
      bucket=target_bucket,
      step_label=coalesce(nullif(trim(body->>'step_label'),''),case target_bucket
        when 'pto' then 'Возврат в ПТО'
        when 'site' then 'На объекте'
        when 'review' then 'На проверке'
        when 'external' then 'У внешней стороны'
        when 'accounting' then 'В бухгалтерии'
        when 'closed' then 'Закрыто' end),
      attention_document_id=case when target_bucket='pto' then attention else null end,
      responsible_user=who,
      updated_at=now()
    where id=process.id
    returning * into process;

    insert into public.pto_process_events(process_id,actor,from_bucket,to_bucket,document_id,note)
    values(process.id,who,from_bucket,target_bucket,attention,trim(coalesce(body->>'note','')));
    insert into public.pto_events(project_id,period_id,document_id,actor,action,detail)
    values(process.project_id,process.period_id,attention,who,'process_transition',jsonb_build_object('process_id',process.id,'from',from_bucket,'to',target_bucket,'note',trim(coalesce(body->>'note',''))));
    update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=process.period_id;
  else
    raise exception 'Неизвестная операция';
  end if;

  result:=jsonb_build_object('process_id',process.id,'project_id',process.project_id,'period_id',process.period_id,'bucket',process.bucket);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;

revoke all on function pto_private.process_command(uuid,jsonb) from public,anon,authenticated;
grant execute on function pto_private.process_command(uuid,jsonb) to authenticated;

create or replace function public.pto_command(request_id uuid,payload jsonb) returns jsonb
language sql set search_path='' as $$
  select case
    when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
    when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
    when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
    when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
    when payload->>'op' in ('create_process','transition_process') then pto_private.process_command(request_id,payload)
    else pto_private.command(request_id,payload)
  end;
$$;
