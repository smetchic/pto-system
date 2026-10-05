-- Шаг 6 плана: единый механизм маршрутов (бриф, раздел 4).
-- * Маршруты хранятся данными: шаблоны и шаги (pto_workflow_templates / pto_workflow_steps).
-- * Комплект (pto_workflows) — по периоду, договору и маршруту; документы попадают в него автоматически.
-- * Переход только командой: проверка права и условий шага, событие (только добавление), смена шага — в одной транзакции.
-- * Бухгалтерия принимает комплект целиком; принятые версии фиксируются, сохранённые версии не изменяются.
-- * Новая версия или новый документ возвращают продвинутый комплект на первый шаг.
-- * Статус документа больше не хранится: он следует из шага комплекта (pto_document_list).
-- Старые таблицы конвейера (pto_processes*) не используются и будут удалены отдельной уборкой.
-- Откат: supabase/rollback/20261005224629_workflows.down.sql

-- 1. Шаблоны маршрутов.
create table public.pto_workflow_templates (
 code text primary key,
 name text not null,
 money boolean not null,
 ordinal int not null unique
);
create table public.pto_workflow_steps (
 template_code text not null references public.pto_workflow_templates(code) on delete restrict,
 code text not null,
 ordinal int not null,
 label text not null,
 actor text not null check (actor in ('pto','accounting','none')),
 requires text[] not null default '{}',
 hint text not null default '',
 primary key(template_code,code),
 unique(template_code,ordinal),
 check (requires <@ array['kit','person','method','proof','files','accept'])
);
comment on column public.pto_workflow_steps.actor is 'Кто действует, пока комплект на шаге: pto — начальник и инженер ПТО, accounting — бухгалтерия (и начальник ПТО), none — маршрут завершён.';
comment on column public.pto_workflow_steps.requires is 'Условия перехода НА шаг: kit — состав и суммы комплекта, person/method/proof — кому, как, подтверждение, files — файл у каждой версии, accept — фиксация принятых версий.';

insert into public.pto_workflow_templates(code,name,money,ordinal) values
 ('claim','Процентовка заказчику',true,1),
 ('sub_claim','Процентовка субподрядчика',true,2),
 ('c29','С-29',false,3);
insert into public.pto_workflow_steps(template_code,code,ordinal,label,actor,requires,hint) values
 ('claim','prepared',1,'Подготовлена ПТО','pto','{}','Соберите акты С-2 и справку С-3а, проверьте суммы, передайте прорабу.'),
 ('claim','site',2,'У прораба','pto','{kit,person}','Прораб проверяет комплект и передаёт технадзору.'),
 ('claim','supervision',3,'Технадзор','pto','{kit,person}','Технадзор визирует комплект; после визы направьте его заказчику.'),
 ('claim','customer',4,'Направлена заказчику','pto','{kit,person,method,proof}','Комплект у заказчика. Зафиксируйте подписание.'),
 ('claim','signed',5,'Подписана заказчиком','pto','{kit,proof}','Приложите сканы подписанных документов и сверьте их.'),
 ('claim','scan',6,'Скан приложен и сверен','pto','{kit,files}','Передайте оригиналы в бухгалтерию.'),
 ('claim','accounting',7,'Оригинал в бухгалтерии','accounting','{kit,files,person,proof}','Бухгалтерия принимает комплект целиком или возвращает с причиной.'),
 ('claim','accepted',8,'Принято бухгалтерией','accounting','{kit,files,accept}','Комплект принят. Закройте его.'),
 ('claim','closed',9,'Закрыто','none','{}',''),
 ('sub_claim','received',1,'Получена','pto','{}','Проверьте процентовку субподрядчика.'),
 ('sub_claim','review',2,'Проверка ПТО','pto','{kit}','Замечания — возврат с причиной; после исправления — согласование.'),
 ('sub_claim','agreed',3,'Согласована','pto','{kit,proof}','Подпишите процентовку.'),
 ('sub_claim','signed',4,'Подписана','pto','{kit,proof}','Передайте оригиналы в бухгалтерию.'),
 ('sub_claim','accounting',5,'Передана в бухгалтерию','accounting','{kit,files,person,proof}','Бухгалтерия принимает или возвращает с причиной.'),
 ('sub_claim','accepted',6,'Принято бухгалтерией','accounting','{kit,files,accept}','Комплект принят. Закройте его.'),
 ('sub_claim','closed',7,'Закрыто','none','{}',''),
 ('c29','formation',1,'Формирование ПТО','pto','{}','Сформируйте С-29 и передайте прорабу.'),
 ('c29','site',2,'У прораба','pto','{kit,person}','Прораб заполняет фактический расход и объяснения.'),
 ('c29','review',3,'Проверка ПТО','pto','{kit}','Замечания — возврат прорабу с причиной.'),
 ('c29','checked',4,'Проверено','pto','{kit,proof}','Передайте С-29 в бухгалтерию.'),
 ('c29','accounting',5,'Передано в бухгалтерию','accounting','{kit,files,person,proof}','Бухгалтерия принимает или возвращает с причиной.'),
 ('c29','accepted',6,'Принято бухгалтерией','accounting','{kit,files,accept}','С-29 принят. Закройте.'),
 ('c29','closed',7,'Закрыто','none','{}','');

-- 2. Комплекты, состав и события.
create table public.pto_workflows (
 id uuid primary key default gen_random_uuid(),
 template_code text not null references public.pto_workflow_templates(code) on delete restrict,
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 period_id uuid not null,
 contract_id uuid not null,
 step_code text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(template_code,step_code) references public.pto_workflow_steps(template_code,code),
 foreign key(period_id,project_id) references public.pto_periods(id,project_id),
 foreign key(contract_id,project_id) references public.pto_contracts(id,project_id),
 unique(period_id,contract_id,template_code)
);
create table public.pto_workflow_documents (
 workflow_id uuid not null references public.pto_workflows(id) on delete restrict,
 document_id uuid not null references public.pto_documents(id) on delete restrict,
 primary key(workflow_id,document_id),
 unique(document_id)
);
create table public.pto_workflow_events (
 id bigint generated always as identity primary key,
 workflow_id uuid not null references public.pto_workflows(id) on delete restrict,
 kind text not null check (kind in ('created','advance','return','reset')),
 from_step text,
 to_step text not null,
 actor uuid references public.pto_profiles(id),
 document_id uuid references public.pto_documents(id),
 person text not null default '',
 method text not null default '',
 proof text not null default '',
 note text not null default '',
 created_at timestamptz not null default now()
);
create index pto_workflows_project_idx on public.pto_workflows(project_id);
create index pto_workflows_period_idx on public.pto_workflows(period_id,project_id);
create index pto_workflows_contract_idx on public.pto_workflows(contract_id,project_id);
create index pto_workflows_step_idx on public.pto_workflows(template_code,step_code);
create index pto_workflow_events_workflow_idx on public.pto_workflow_events(workflow_id,id desc);
create index pto_workflow_events_actor_idx on public.pto_workflow_events(actor);
create index pto_workflow_events_document_idx on public.pto_workflow_events(document_id);

alter table public.pto_workflow_templates enable row level security;
alter table public.pto_workflow_steps enable row level security;
alter table public.pto_workflows enable row level security;
alter table public.pto_workflow_documents enable row level security;
alter table public.pto_workflow_events enable row level security;
revoke all on public.pto_workflow_templates, public.pto_workflow_steps, public.pto_workflows, public.pto_workflow_documents, public.pto_workflow_events from anon, authenticated;
grant select on public.pto_workflow_templates, public.pto_workflow_steps, public.pto_workflows, public.pto_workflow_documents, public.pto_workflow_events to authenticated;
create policy templates_read on public.pto_workflow_templates for select to authenticated using (pto_private.my_role() is not null);
create policy steps_read on public.pto_workflow_steps for select to authenticated using (pto_private.my_role() is not null);
create policy scoped_read on public.pto_workflows for select to authenticated using (pto_private.can_access(project_id));
create policy scoped_read on public.pto_workflow_documents for select to authenticated using (exists(select 1 from public.pto_workflows w where w.id=workflow_id and pto_private.can_access(w.project_id)));
create policy scoped_read on public.pto_workflow_events for select to authenticated using (exists(select 1 from public.pto_workflows w where w.id=workflow_id and pto_private.can_access(w.project_id)));
create trigger pto_workflow_events_append_only before update or delete on public.pto_workflow_events for each row execute function pto_private.forbid_change();
create trigger pto_workflow_events_no_truncate before truncate on public.pto_workflow_events for each statement execute function pto_private.forbid_change();

-- 3. Вспомогательные функции маршрута.
-- Основание С-3а и С-29: текущие версии актов договора за период.
create or replace function pto_private.kit_sources(pid uuid, cid uuid) returns text
language sql stable set search_path='' as $$
 select coalesce(string_agg(d.current_version::text,',' order by d.id),'') from public.pto_documents d
 where d.period_id=pid and d.contract_id=cid and d.kind in ('c2a','c2b') and d.current_version is not null;
$$;

create or replace function pto_private.workflow_template_for(kind text, direction text) returns text
language sql immutable set search_path='' as $$
 select case when kind='c29' then 'c29' when direction='outgoing' then 'claim' else 'sub_claim' end;
$$;

-- Документ попадает в комплект своего маршрута. Если комплект уже продвинут — он возвращается на первый шаг.
create or replace function pto_private.workflow_link(doc_id uuid, actor_id uuid, reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.pto_documents; tpl text; wf public.pto_workflows; first_step text;
begin
 select * into d from public.pto_documents where id=doc_id;
 tpl:=pto_private.workflow_template_for(d.kind,(select direction from public.pto_contracts where id=d.contract_id));
 select code into first_step from public.pto_workflow_steps where template_code=tpl and ordinal=1;
 insert into public.pto_workflows(template_code,project_id,period_id,contract_id,step_code)
 values(tpl,d.project_id,d.period_id,d.contract_id,first_step)
 on conflict(period_id,contract_id,template_code) do nothing;
 select * into wf from public.pto_workflows where period_id=d.period_id and contract_id=d.contract_id and template_code=tpl for update;
 if not exists(select 1 from public.pto_workflow_events where workflow_id=wf.id) then
  insert into public.pto_workflow_events(workflow_id,kind,to_step,actor,note) values(wf.id,'created',wf.step_code,actor_id,'Комплект создан');
 end if;
 insert into public.pto_workflow_documents(workflow_id,document_id) values(wf.id,d.id) on conflict do nothing;
 perform pto_private.workflow_reset(wf.id,actor_id,d.id,reason);
 return wf.id;
end $$;

create or replace function pto_private.workflow_reset(wf_id uuid, actor_id uuid, doc_id uuid, reason text) returns void
language plpgsql security definer set search_path='' as $$
declare wf public.pto_workflows; first_step text;
begin
 select * into wf from public.pto_workflows where id=wf_id for update;
 select code into first_step from public.pto_workflow_steps where template_code=wf.template_code and ordinal=1;
 if wf.step_code<>first_step then
  update public.pto_workflows set step_code=first_step,updated_at=now() where id=wf.id;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,note)
  values(wf.id,'reset',wf.step_code,first_step,actor_id,doc_id,reason);
 end if;
end $$;

-- Проблема состава комплекта (null — комплект в порядке).
create or replace function pto_private.kit_problem(wf_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare
 wf public.pto_workflows; acts int; c3 int; c29 int; missing int;
 acts_total numeric; c3_amount numeric; c3_sources text; c29_sources text;
begin
 select * into wf from public.pto_workflows where id=wf_id;
 select count(*) filter(where d.kind in ('c2a','c2b')),count(*) filter(where d.kind='c3a'),count(*) filter(where d.kind='c29'),
  count(*) filter(where v.id is null),coalesce(sum(v.amount) filter(where d.kind in ('c2a','c2b')),0),
  max(v.amount) filter(where d.kind='c3a'),max(v.sources) filter(where d.kind='c3a'),max(v.sources) filter(where d.kind='c29')
 into acts,c3,c29,missing,acts_total,c3_amount,c3_sources,c29_sources
 from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
 left join public.pto_versions v on v.id=d.current_version
 where wd.workflow_id=wf.id;
 if missing>0 then return 'В комплекте есть документ без версии'; end if;
 if wf.template_code='c29' then
  if c29<>1 then return 'В комплекте должна быть одна С-29'; end if;
  if c29_sources is distinct from pto_private.kit_sources(wf.period_id,wf.contract_id) then return 'Обновите С-29 по актуальным актам'; end if;
  return null;
 end if;
 if acts=0 then return 'В комплекте нет актов С-2'; end if;
 if wf.template_code='claim' and c3<>1 then return 'Для передачи нужен комплект: акты и одна С-3а'; end if;
 if c3>1 then return 'В комплекте больше одной С-3а'; end if;
 if c3=1 and c3_sources is distinct from pto_private.kit_sources(wf.period_id,wf.contract_id) then return 'Обновите С-3а по актуальным актам'; end if;
 if c3=1 and c3_amount is distinct from acts_total then return 'Сумма С-3а не совпадает с актами комплекта'; end if;
 return null;
end $$;

-- 4. Команда маршрута: вперёд на следующий шаг или возврат на более ранний с причиной.
create or replace function pto_private.workflow_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op';
 wf public.pto_workflows; per public.pto_periods; cur public.pto_workflow_steps; nxt public.pto_workflow_steps;
 problem text; attention uuid; result jsonb; prior pto_private.requests;
 person_value text:=trim(coalesce(body->>'person','')); method_value text:=trim(coalesce(body->>'method',''));
 proof_value text:=trim(coalesce(body->>'proof','')); note_value text:=trim(coalesce(body->>'note',''));
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
 select * into wf from public.pto_workflows where id=(body->>'workflow_id')::uuid for update;
 if not found then raise exception 'Комплект не найден'; end if;
 if not coalesce(pto_private.can_access(wf.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 select * into per from public.pto_periods where id=wf.period_id for update;
 if per.status<>'open' then raise exception 'Период закрыт'; end if;
 if nullif(body->>'expected_revision','') is not null and (body->>'expected_revision')::integer is distinct from per.revision then
  raise exception 'Данные уже изменились. Обновите страницу' using errcode='40001';
 end if;
 select * into cur from public.pto_workflow_steps where template_code=wf.template_code and code=wf.step_code;
 if cur.actor='none' then raise exception 'Маршрут завершён'; end if;
 if cur.actor='pto' and role_name not in ('head','engineer') then raise exception 'Шаг выполняет ПТО' using errcode='42501'; end if;
 if cur.actor='accounting' and role_name not in ('accountant','head') then raise exception 'Шаг выполняет бухгалтерия' using errcode='42501'; end if;

 if op='workflow_advance' then
  select * into nxt from public.pto_workflow_steps where template_code=wf.template_code and ordinal=cur.ordinal+1;
  if 'kit'=any(nxt.requires) then
   problem:=pto_private.kit_problem(wf.id);
   if problem is not null then raise exception '%',problem; end if;
  end if;
  if 'person'=any(nxt.requires) and length(person_value)<2 then raise exception 'Укажите, кому передан комплект'; end if;
  if 'method'=any(nxt.requires) and length(method_value)=0 then raise exception 'Укажите способ передачи'; end if;
  if 'proof'=any(nxt.requires) and length(proof_value)<3 then raise exception 'Укажите подтверждение: номер письма, описи, отметку о подписи'; end if;
  if 'files'=any(nxt.requires) and exists(
   select 1 from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
   where wd.workflow_id=wf.id and not exists(select 1 from public.pto_files f where f.version_id=d.current_version)
  ) then raise exception 'Приложите файл к каждому документу комплекта'; end if;
  if 'accept'=any(nxt.requires) then
   -- Бухгалтерия принимает комплект целиком: все текущие версии становятся принятыми.
   update public.pto_documents d set accepted_version=d.current_version
   from public.pto_workflow_documents wd where wd.workflow_id=wf.id and wd.document_id=d.id;
  end if;
  update public.pto_workflows set step_code=nxt.code,updated_at=now() where id=wf.id;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,person,method,proof,note)
  values(wf.id,'advance',cur.code,nxt.code,who,person_value,method_value,proof_value,note_value);
 elsif op='workflow_return' then
  select * into nxt from public.pto_workflow_steps where template_code=wf.template_code and code=body->>'to_step';
  if not found or nxt.ordinal>=cur.ordinal then raise exception 'Вернуть можно только на один из предыдущих шагов'; end if;
  if length(note_value)<3 then raise exception 'Укажите причину возврата'; end if;
  attention:=nullif(body->>'document_id','')::uuid;
  if attention is not null and not exists(select 1 from public.pto_workflow_documents where workflow_id=wf.id and document_id=attention) then
   raise exception 'Документ не входит в комплект';
  end if;
  update public.pto_workflows set step_code=nxt.code,updated_at=now() where id=wf.id;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,note)
  values(wf.id,'return',cur.code,nxt.code,who,attention,note_value);
 else
  raise exception 'Неизвестная операция';
 end if;

 update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id;
 insert into public.pto_events(project_id,period_id,document_id,actor,action,detail)
 values(wf.project_id,wf.period_id,attention,who,op,body || jsonb_build_object('from',cur.code,'to',nxt.code,'template',wf.template_code));
 result:=jsonb_build_object('workflow_id',wf.id,'project_id',wf.project_id,'period_id',wf.period_id,'step',nxt.code);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;

-- 5. Документы: без собственного статуса; новая версия возвращает комплект на первый шаг.
create or replace function pto_private.command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op'; project uuid; pid uuid; did uuid; vid uuid;
 per public.pto_periods; doc public.pto_documents; ver public.pto_versions; con public.pto_contracts;
 outgoing public.pto_documents; incoming public.pto_documents;
 result jsonb; prior pto_private.requests; amount numeric(16,2); data jsonb; target uuid;
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(722022);
 role_name:=pto_private.my_role();
 if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 if op='member' then
  if role_name not in ('head','admin') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  project:=(body->>'project_id')::uuid; target:=(body->>'user_id')::uuid;
  if coalesce((body->>'remove')::boolean,false) then delete from public.pto_memberships where project_id=project and user_id=target;
  else insert into public.pto_memberships values(project,target) on conflict do nothing; end if;
 elsif op='profile' then
  if role_name<>'admin' then raise exception 'Только администратор' using errcode='42501'; end if;
  target:=(body->>'user_id')::uuid;
  if target=who then raise exception 'Свою роль изменять нельзя'; end if;
  update public.pto_profiles set role=body->>'role',active=(body->>'active')::boolean,display_name=trim(body->>'display_name') where id=target;
  if not found then raise exception 'Сотрудник не найден'; end if;
 elsif op in ('open_period','reopen','review','close','allocate','create_document','revise','attach') then
  if op='open_period' then
   project:=(body->>'project_id')::uuid;
  else
   pid:=(body->>'period_id')::uuid;
   select * into per from public.pto_periods where id=pid for update;
   if not found then raise exception 'Период не найден'; end if;
   project:=per.project_id;
  end if;
  if not coalesce(pto_private.can_access(project),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  if op='open_period' then
   if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
   insert into public.pto_periods(project_id,month) values(project,(body->>'month')::date) on conflict(project_id,month) do nothing;
   select id into pid from public.pto_periods where project_id=project and month=(body->>'month')::date;
  else
   if (body->>'expected_revision')::integer is distinct from per.revision then raise exception 'Данные уже изменились. Обновите страницу' using errcode='40001'; end if;
   if per.status='closed' and op<>'reopen' then raise exception 'Период закрыт'; end if;
   if op='reopen' then
    if role_name<>'admin' or per.status<>'closed' then raise exception 'Повторное открытие доступно администратору закрытого периода' using errcode='42501'; end if;
    if length(trim(coalesce(body->>'reason','')))<5 then raise exception 'Укажите причину открытия'; end if;
    update public.pto_periods set status='open' where id=pid;
   elsif op in ('review','close') then
    if role_name<>'head' then raise exception 'Только начальник ПТО' using errcode='42501'; end if;
    if not exists(select 1 from public.pto_documents d join public.pto_contracts c on c.id=d.contract_id where d.period_id=pid and c.direction='outgoing' and d.kind in ('c2a','c2b')) then raise exception 'Нет исходящих актов'; end if;
    if exists(select 1 from public.pto_workflows w where w.period_id=pid and w.step_code not in ('accepted','closed')) then raise exception 'Есть комплекты, не принятые бухгалтерией'; end if;
    if exists(select 1 from public.pto_documents where period_id=pid and current_version is distinct from accepted_version) then raise exception 'Есть непринятые версии документов'; end if;
    if exists(select 1 from unnest(per.required_kinds) k where not exists(select 1 from public.pto_documents d where d.period_id=pid and (d.kind=k or (k='act' and d.kind in ('c2a','c2b'))))) then raise exception 'Не сформирован обязательный комплект'; end if;
    if exists(select 1 from public.pto_documents d join public.pto_versions v on v.id=d.current_version where d.period_id=pid and d.kind in ('c3a','c29') and v.sources<>pto_private.kit_sources(pid,d.contract_id)) then raise exception 'Обновите справку и С-29 по актуальным актам'; end if;
    if exists(select 1 from public.pto_allocations a join public.pto_documents o on o.id=a.outgoing_document join public.pto_documents i on i.id=a.incoming_document where a.period_id=pid and (a.outgoing_version is distinct from o.accepted_version or a.incoming_version is distinct from i.accepted_version)) then raise exception 'Обновите распределение субподряда'; end if;
    if exists(select 1 from public.pto_documents d join public.pto_contracts c on c.id=d.contract_id where d.period_id=pid and c.direction='incoming' and d.kind in ('c2a','c2b') and not exists(select 1 from public.pto_allocations a where a.incoming_document=d.id)) then raise exception 'Не сопоставлен входящий субподряд'; end if;
    if op='review' then
     update public.pto_periods set reviewed_revision=revision,reviewed_by=who where id=pid;
    else
     if per.reviewed_revision is distinct from per.revision then raise exception 'Нужна актуальная проверка начальника ПТО'; end if;
     select jsonb_build_object('register',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.pto_register r where r.period_id=pid),
       'documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.pto_documents d where d.period_id=pid),
       'allocations',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.pto_allocations a where a.period_id=pid),
       'workflows',(select coalesce(jsonb_agg(to_jsonb(w)),'[]') from public.pto_workflows w where w.period_id=pid)) into data;
     insert into public.pto_snapshots(project_id,period_id,revision,data,created_by) values(project,pid,per.revision,data,who);
     update public.pto_periods set status='closed' where id=pid;
    end if;
   elsif op='allocate' then
    if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
    select * into outgoing from public.pto_documents where id=(body->>'outgoing_document')::uuid and period_id=pid and kind in ('c2a','c2b');
    select * into incoming from public.pto_documents where id=(body->>'incoming_document')::uuid and period_id=pid and kind in ('c2a','c2b');
    if outgoing.id is null or incoming.id is null or outgoing.accepted_version is null or incoming.accepted_version is null then raise exception 'Выберите принятые акты одного периода'; end if;
    if (select direction from public.pto_contracts where id=outgoing.contract_id)<>'outgoing' or (select direction from public.pto_contracts where id=incoming.contract_id)<>'incoming' then raise exception 'Неверные направления актов'; end if;
    amount:=(body->>'amount')::numeric;
    if amount<=0 or amount is null then raise exception 'Сумма должна быть больше нуля'; end if;
    insert into public.pto_allocations(project_id,period_id,outgoing_document,incoming_document,outgoing_version,incoming_version,amount,note)
    values(project,pid,outgoing.id,incoming.id,outgoing.accepted_version,incoming.accepted_version,amount,trim(body->>'note'))
    on conflict(outgoing_document,incoming_document) do update set outgoing_version=excluded.outgoing_version,incoming_version=excluded.incoming_version,amount=excluded.amount,note=excluded.note;
   else
    if role_name not in ('head','engineer') then raise exception 'Нет права редактировать документы' using errcode='42501'; end if;
    if op='create_document' then
     select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid and project_id=project;
     if not found then raise exception 'Договор не относится к объекту'; end if;
     if length(trim(coalesce(body->>'number','')))=0 then raise exception 'Укажите номер'; end if;
     if body->>'kind' not in ('c2a','c2b','c3a','c29') then raise exception 'Неизвестная форма документа'; end if;
     insert into public.pto_documents(project_id,period_id,contract_id,kind,number,due_date)
     values(project,pid,con.id,body->>'kind',trim(body->>'number'),nullif(body->>'due_date','')::date) returning * into doc;
    else
     select * into doc from public.pto_documents where id=(body->>'document_id')::uuid and period_id=pid for update;
     if not found then raise exception 'Документ не найден в периоде'; end if;
     select * into ver from public.pto_versions where id=doc.current_version;
    end if;
    did:=doc.id;
    if op in ('create_document','revise') then
     if op='revise' and length(trim(coalesce(body->>'reason','')))<3 then raise exception 'Укажите причину новой версии'; end if;
     if doc.kind='c3a' then
      -- СМР с НДС не вводится: сумма текущих версий актов договора за период (акты С-2 с НДС, принимаются вместе с С-3а).
      amount:=(select coalesce(sum(v.amount),0) from public.pto_documents a join public.pto_versions v on v.id=a.current_version
       where a.period_id=pid and a.contract_id=doc.contract_id and a.kind in ('c2a','c2b'));
     elsif doc.kind='c29' then
      amount:=0;
     else
      amount:=(body->>'amount')::numeric;
      if amount is null or amount<=0 or amount::text='NaN' then raise exception 'Некорректная сумма акта'; end if;
     end if;
     insert into public.pto_versions(document_id,project_id,version,amount,note,sources,created_by,
      smr_vat,equipment_amount,equipment_vat,advance_target_offset,advance_current_offset)
     values(did,project,coalesce(ver.version,0)+1,amount,coalesce(body->>'note',''),pto_private.kit_sources(pid,doc.contract_id),who,
      case when doc.kind='c3a' then case when body ? 'smr_vat' then pto_private.money_arg(body->>'smr_vat','НДС СМР') else ver.smr_vat end end,
      case when doc.kind='c3a' then case when body ? 'equipment_amount' then pto_private.money_arg(body->>'equipment_amount','оборудование') else ver.equipment_amount end end,
      case when doc.kind='c3a' then case when body ? 'equipment_vat' then pto_private.money_arg(body->>'equipment_vat','НДС оборудования') else ver.equipment_vat end end,
      case when doc.kind='c3a' then case when body ? 'advance_target_offset' then pto_private.money_arg(body->>'advance_target_offset','зачёт целевого аванса') else ver.advance_target_offset end end,
      case when doc.kind='c3a' then case when body ? 'advance_current_offset' then pto_private.money_arg(body->>'advance_current_offset','зачёт текущего аванса') else ver.advance_current_offset end end)
     returning id into vid;
     update public.pto_documents set current_version=vid where id=did;
     -- Документ — в комплект своего маршрута; изменение продвинутого комплекта возвращает его на первый шаг.
     perform pto_private.workflow_link(did,who,case when op='create_document' then 'Добавлен документ № '||doc.number
      else 'Новая версия документа № '||doc.number||': '||trim(body->>'reason') end);
    elsif op='attach' then
     if exists(select 1 from public.pto_workflow_documents wd join public.pto_workflows w on w.id=wd.workflow_id
      where wd.document_id=did and w.step_code in ('accepted','closed')) then raise exception 'Комплект принят бухгалтерией: для изменений создайте новую версию'; end if;
     if split_part(body->>'path','/',1)<>project::text or split_part(body->>'path','/',2)<>did::text or split_part(body->>'path','/',3)<>doc.current_version::text then raise exception 'Неверный путь файла'; end if;
     if not exists(select 1 from storage.objects where bucket_id='pto-documents' and name=body->>'path') then raise exception 'Файл ещё не загружен'; end if;
     insert into public.pto_files(project_id,version_id,path,name,uploaded_by) values(project,doc.current_version,body->>'path',body->>'name',who);
    end if;
   end if;
   if op not in ('review','close') then update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=pid; end if;
  end if;
 elsif op in ('send','receive','sign','accept') then
  raise exception 'Передача, подпись и принятие выполняются по маршруту комплекта';
 else
  raise exception 'Неизвестная операция';
 end if;
 insert into public.pto_events(project_id,period_id,document_id,actor,action,detail) values(project,pid,did,who,op,body);
 result:=jsonb_build_object('project_id',project,'period_id',pid,'document_id',did,'version_id',vid);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.command(uuid,jsonb) from public,anon;
grant execute on function pto_private.command(uuid,jsonb) to authenticated;

-- 6. Перенос: прежний конвейер и статусы документов → комплекты.
drop trigger pto_documents_auto_progress_process on public.pto_documents;
drop function pto_private.auto_link_progress_process();
drop function pto_private.process_command(uuid,jsonb);

insert into public.pto_workflows(template_code,project_id,period_id,contract_id,step_code)
select distinct pto_private.workflow_template_for(d.kind,c.direction),d.project_id,d.period_id,d.contract_id,
 (select s.code from public.pto_workflow_steps s where s.template_code=pto_private.workflow_template_for(d.kind,c.direction) and s.ordinal=1)
from public.pto_documents d join public.pto_contracts c on c.id=d.contract_id
on conflict do nothing;
insert into public.pto_workflow_documents(workflow_id,document_id)
select w.id,d.id from public.pto_documents d join public.pto_contracts c on c.id=d.contract_id
join public.pto_workflows w on w.period_id=d.period_id and w.contract_id=d.contract_id and w.template_code=pto_private.workflow_template_for(d.kind,c.direction);
-- Комплект, все документы которого были приняты, переносится на шаг «Принято бухгалтерией».
update public.pto_workflows w set step_code='accepted'
where not exists(select 1 from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
 where wd.workflow_id=w.id and (d.status<>'accepted' or d.current_version is distinct from d.accepted_version));
insert into public.pto_workflow_events(workflow_id,kind,to_step,note)
select id,'created',step_code,'Перенесено из прежнего конвейера' from public.pto_workflows;

-- Статус документа теперь следует из шага комплекта.
drop policy pto_file_upload on storage.objects;
alter table public.pto_documents drop column status;
create policy pto_file_upload on storage.objects for insert to authenticated with check(bucket_id='pto-documents' and pto_private.my_role() in ('head','engineer') and exists(
 select 1 from public.pto_documents d join public.pto_periods p on p.id=d.period_id
 where d.project_id::text=split_part(name,'/',1) and d.id::text=split_part(name,'/',2) and d.current_version::text=split_part(name,'/',3)
 and p.status='open' and pto_private.can_access(d.project_id)
 and not exists(select 1 from public.pto_workflow_documents wd join public.pto_workflows w on w.id=wd.workflow_id
  where wd.document_id=d.id and w.step_code in ('accepted','closed'))));

-- 7. Представления: комплекты, документы со стадией.
create view public.pto_workflow_list with(security_invoker=true) as
select w.*,t.name template_name,t.money,t.ordinal template_ordinal,s.label step_label,s.ordinal step_ordinal,s.actor,s.hint,
 (select max(x.ordinal) from public.pto_workflow_steps x where x.template_code=w.template_code) last_ordinal,
 pr.name project,c.number contract_number,coalesce(cp.short_name,c.party_text) party,per.month,
 (select count(*) from public.pto_workflow_documents wd where wd.workflow_id=w.id)::int documents,
 (select coalesce(sum(v.amount),0) from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
  join public.pto_versions v on v.id=d.current_version where wd.workflow_id=w.id and d.kind in ('c2a','c2b'))::numeric(18,2) acts_amount,
 le.created_at last_event_at,le.kind last_event_kind,le.note last_note,
 case when le.kind in ('return','reset') then le.document_id end attention_document_id
from public.pto_workflows w
join public.pto_workflow_templates t on t.code=w.template_code
join public.pto_workflow_steps s on s.template_code=w.template_code and s.code=w.step_code
join public.pto_projects pr on pr.id=w.project_id
join public.pto_periods per on per.id=w.period_id
join public.pto_contracts c on c.id=w.contract_id
left join public.pto_counterparties cp on cp.id=c.counterparty_id
left join lateral (select e.* from public.pto_workflow_events e where e.workflow_id=w.id order by e.id desc limit 1) le on true;

create view public.pto_document_list with(security_invoker=true) as
select d.*,w.id workflow_id,w.template_code,w.step_code,s.label step_label,s.ordinal step_ordinal,
 (d.accepted_version is not null and d.accepted_version=d.current_version and w.step_code in ('accepted','closed')) is_accepted
from public.pto_documents d
left join public.pto_workflow_documents wd on wd.document_id=d.id
left join public.pto_workflows w on w.id=wd.workflow_id
left join public.pto_workflow_steps s on s.template_code=w.template_code and s.code=w.step_code;

revoke all on public.pto_workflow_list, public.pto_document_list from anon, authenticated;
grant select on public.pto_workflow_list, public.pto_document_list to authenticated;

-- 8. Реестр (решение пользователя): до принятия бухгалтерией — суммы актов, подписанных заказчиком, с пометкой.
create or replace function public.pto_register_matrix(p_month date) returns jsonb
language sql stable set search_path='' as $$
with reg0 as (
 select r.period_id,r.project_id,r.contract_id,r.total::numeric(18,2) total,r.subcontract::numeric(18,2) subcontract
 from public.pto_register r where r.month=p_month
),
signed as (
 select w.period_id,w.contract_id,sum(v.amount)::numeric(18,2) amount
 from public.pto_workflows w
 join public.pto_periods p on p.id=w.period_id
 join public.pto_workflow_documents wd on wd.workflow_id=w.id
 join public.pto_documents d on d.id=wd.document_id and d.kind in ('c2a','c2b')
 join public.pto_versions v on v.id=d.current_version
 where p.month=p_month and w.template_code='claim' and w.step_code in ('signed','scan','accounting')
 group by 1,2
),
est as (
 select distinct on (e.period_id,e.contract_id) e.period_id,e.project_id,e.contract_id,e.amount
 from public.pto_estimates e join public.pto_periods p on p.id=e.period_id
 where p.month=p_month
 order by e.period_id,e.contract_id,e.created_at desc,e.id desc
),
reg as (
 select coalesce(r.period_id,e.period_id) period_id,coalesce(r.project_id,e.project_id) project_id,c.id contract_id,c.number,
  case when coalesce(r.total,0)<>0 then r.total else coalesce(s.amount,0) end::numeric(18,2) total,
  coalesce(r.subcontract,0)::numeric(18,2) subcontract,e.amount estimate,
  case when coalesce(r.total,0)<>0 then 'c3a' when coalesce(s.amount,0)<>0 then 'signed' end basis
 from reg0 r
 full join est e on e.period_id=r.period_id and e.contract_id=r.contract_id
 join public.pto_contracts c on c.id=coalesce(r.contract_id,e.contract_id)
 left join signed s on s.period_id=coalesce(r.period_id,e.period_id) and s.contract_id=c.id
 where coalesce(r.total,0)<>0 or coalesce(r.subcontract,0)<>0 or coalesce(e.amount,0)<>0 or coalesce(s.amount,0)<>0
),
cells as (
 select a.period_id,o.contract_id out_contract,i.contract_id in_contract,sum(a.amount)::numeric(18,2) amount
 from public.pto_allocations a
 join public.pto_documents o on o.id=a.outgoing_document
 join public.pto_documents i on i.id=a.incoming_document
 join reg on reg.period_id=a.period_id and reg.contract_id=o.contract_id
 group by 1,2,3
 having sum(a.amount)<>0
),
cols as (
 select c.id,c.number,coalesce(nullif(trim(cp.short_name),''),c.party_text) base,coalesce(c.counterparty_id::text,c.party_text) party_key
 from public.pto_contracts c
 left join public.pto_counterparties cp on cp.id=c.counterparty_id
 where c.id in (select in_contract from cells)
),
labeled as (
 select id,case when count(*) over(partition by party_key)>1 then base||' · №'||number else base end label from cols
),
rows_c as (
 select reg.project_id,p.name project,reg.contract_id,reg.number,reg.total,reg.subcontract,(reg.total-reg.subcontract)::numeric(18,2) own,reg.estimate,reg.basis,
  coalesce((select jsonb_object_agg(c.in_contract,c.amount::text) from cells c where c.period_id=reg.period_id and c.out_contract=reg.contract_id),'{}'::jsonb) cells
 from reg join public.pto_projects p on p.id=reg.project_id
),
rows_p as (
 select rc.project_id,rc.project,sum(rc.total)::numeric(18,2) total,sum(rc.subcontract)::numeric(18,2) subcontract,sum(rc.own)::numeric(18,2) own,
  sum(rc.estimate)::numeric(18,2) estimate,
  coalesce((select jsonb_object_agg(t.in_contract,t.s::text) from (
   select c.in_contract,sum(c.amount)::numeric(18,2) s from cells c join reg r on r.period_id=c.period_id and r.contract_id=c.out_contract
   where r.project_id=rc.project_id group by c.in_contract) t),'{}'::jsonb) cells
 from rows_c rc
 group by rc.project_id,rc.project
 having count(*)>1
)
select jsonb_build_object(
 'month',p_month,
 'columns',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,
   'total',(select sum(c.amount) from cells c where c.in_contract=l.id)::numeric(18,2)::text) order by l.label,l.id) from labeled l),'[]'::jsonb),
 'rows',coalesce((select jsonb_agg(x.j order by x.project,x.project_id,x.ord,x.number) from (
   select project,project_id,0 ord,number,jsonb_build_object('kind','contract','project_id',project_id,'project',project,'contract_id',contract_id,'number',number,
    'total',total::text,'own',own::text,'subcontract',subcontract::text,'estimate',estimate::text,'basis',basis,'cells',cells) j from rows_c
   union all
   select project,project_id,1,'',jsonb_build_object('kind','project','project_id',project_id,'project',project,
    'total',total::text,'own',own::text,'subcontract',subcontract::text,'estimate',estimate::text,'cells',cells) from rows_p) x),'[]'::jsonb),
 'total',jsonb_build_object(
  'total',(select coalesce(sum(total),0) from reg)::numeric(18,2)::text,
  'subcontract',(select coalesce(sum(subcontract),0) from reg)::numeric(18,2)::text,
  'own',(select coalesce(sum(total-subcontract),0) from reg)::numeric(18,2)::text,
  'estimate',(select sum(estimate) from reg)::numeric(18,2)::text,
  'cells',coalesce((select jsonb_object_agg(t.in_contract,t.s::text) from (select in_contract,sum(amount)::numeric(18,2) s from cells group by 1) t),'{}'::jsonb))
);
$$;
revoke all on function public.pto_register_matrix(date) from public, anon;
grant execute on function public.pto_register_matrix(date) to authenticated;

-- 9. Права на новые функции и диспетчер команд.
revoke all on function pto_private.kit_sources(uuid,uuid), pto_private.workflow_template_for(text,text), pto_private.workflow_link(uuid,uuid,text),
 pto_private.workflow_reset(uuid,uuid,uuid,text), pto_private.kit_problem(uuid), pto_private.workflow_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.workflow_command(uuid,jsonb), pto_private.kit_sources(uuid,uuid) to authenticated;

create or replace function public.pto_command(request_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(722022);
 return case
  when payload->>'op'='create_project' then pto_private.create_project(request_id,payload)
  when payload->>'op'='create_contract' then pto_private.create_contract(request_id,payload)
  when payload->>'op' in ('update_contract','create_addendum','set_addendum_status') then pto_private.contract_command(request_id,payload)
  when payload->>'op' in ('create_counterparty','update_counterparty') then pto_private.counterparty_command(request_id,payload)
  when payload->>'op' in ('add_project_participant','remove_project_participant') then pto_private.project_participant_command(request_id,payload)
  when payload->>'op'='set_estimate' then pto_private.estimate_command(request_id,payload)
  when payload->>'op' in ('workflow_advance','workflow_return') then pto_private.workflow_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
