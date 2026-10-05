-- Откат миграции 20261005225326_drop_legacy_conveyor.sql: восстанавливает пустую структуру прежнего конвейера
-- (определения из 20261004174232, 20261005135043, 20261005135320, 20261005140541, 20261005213054) и заполняет её
-- комплектами процентовок по текущим документам. События прежнего конвейера не восстанавливаются (их не было).
-- Таблицы не используются кодом: откат нужен только вместе с откатом шага 6 (20261005224629).
-- После выполнения удалить запись версии 20261005225326 из supabase_migrations.schema_migrations.

create function pto_private.sources_for(pid uuid) returns text language sql stable set search_path='' as $$
 select coalesce(string_agg(d.accepted_version::text,',' order by d.id),'') from public.pto_documents d
 join public.pto_contracts c on c.id=d.contract_id
 where d.period_id=pid and d.kind in ('c2a','c2b') and c.direction='outgoing' and d.accepted_version is not null;
$$;
revoke all on function pto_private.sources_for(uuid) from public,anon,authenticated;

create table public.pto_processes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pto_projects(id) on delete restrict,
  period_id uuid not null references public.pto_periods(id) on delete restrict,
  contract_id uuid not null references public.pto_contracts(id) on delete restrict,
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
create index pto_processes_project_period_idx on public.pto_processes(project_id,period_id);
create index pto_processes_bucket_idx on public.pto_processes(bucket,period_id);
create index pto_processes_contract_idx on public.pto_processes(contract_id);
create index pto_processes_attention_document_idx on public.pto_processes(attention_document_id);
create index pto_processes_responsible_user_idx on public.pto_processes(responsible_user);

create table public.pto_process_documents (
  process_id uuid not null references public.pto_processes(id) on delete restrict,
  document_id uuid not null references public.pto_documents(id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key(process_id,document_id),
  unique(document_id)
);
create index pto_process_documents_document_idx on public.pto_process_documents(document_id);

create table public.pto_process_events (
  id bigint generated always as identity primary key,
  process_id uuid not null references public.pto_processes(id) on delete restrict,
  actor uuid not null references public.pto_profiles(id),
  from_bucket text,
  to_bucket text not null,
  document_id uuid references public.pto_documents(id) on delete restrict,
  note text not null default '',
  person text not null default '',
  method text not null default '',
  proof text not null default '',
  created_at timestamptz not null default now()
);
create index pto_process_events_process_created_idx on public.pto_process_events(process_id,created_at desc);
create index pto_process_events_actor_idx on public.pto_process_events(actor);
create index pto_process_events_document_idx on public.pto_process_events(document_id);

alter table public.pto_processes enable row level security;
alter table public.pto_process_documents enable row level security;
alter table public.pto_process_events enable row level security;
revoke all on public.pto_processes, public.pto_process_documents, public.pto_process_events from anon, authenticated;
grant select on public.pto_processes, public.pto_process_documents, public.pto_process_events to authenticated;
create policy processes_read on public.pto_processes for select to authenticated
 using (coalesce(pto_private.can_access(project_id),false));
create policy process_documents_read on public.pto_process_documents for select to authenticated
 using (exists (select 1 from public.pto_processes p where p.id=process_id and coalesce(pto_private.can_access(p.project_id),false)));
create policy process_events_read on public.pto_process_events for select to authenticated
 using (exists (select 1 from public.pto_processes p where p.id=process_id and coalesce(pto_private.can_access(p.project_id),false)));
create trigger pto_process_events_append_only before update or delete on public.pto_process_events for each row execute function pto_private.forbid_change();
create trigger pto_process_events_no_truncate before truncate on public.pto_process_events for each statement execute function pto_private.forbid_change();

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
