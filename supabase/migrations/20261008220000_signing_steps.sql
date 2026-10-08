-- Экран «Подписание» (docs/conveyor.md, решения пользователя от 08.10.2026), шаг 2: база.
-- * Шесть общих шагов: Ждём объёмы → Готовятся акты → У технадзора → На проверке → Проверено → В бухгалтерии.
--   Коды шагов одинаковы во всех маршрутах: wait, acts, tn, check, signed, accepted. Субподрядчик пропускает acts.
--   Последний шаг «В бухгалтерии» сохраняет код accepted: передача в бухгалтерию фиксирует принятые версии
--   (бухгалтерия системой не пользуется), поэтому закрытие месяца, вложения и реестр работают по-прежнему.
-- * Только вперёд: замечание — флажок на том же шаге (событие note / note_off), назад только «Отменить переход» (undo).
-- * Дата шага вводится пользователем (event_date): сдача объёмов, отправка заказчику, подписание и т. д.
-- * Ожидаемые карточки не хранятся; хранится только снятое ожидание с причиной (pto_workflow_skips).
-- * Новая версия документа не возвращает комплект назад: до отправки — запись в истории, после — замечание.
-- * Наша процентовка уходит заказчику, когда все субподрядчики месяца прошли технадзор или исключены с причиной.
-- Откат: supabase/rollback/20261008220000_signing_steps.down.sql

-- 1. События маршрута: дата шага, источник и круг замечания, ссылка на событие (откат их оставляет, отсюда if not exists).
alter table public.pto_workflow_events drop constraint pto_workflow_events_kind_check;
alter table public.pto_workflow_events add constraint pto_workflow_events_kind_check
 check (kind in ('created','advance','return','reset','start','undo','note','note_off','received','revised'));
alter table public.pto_workflow_events
 add column if not exists event_date date,
 add column if not exists source text not null default '',
 add column if not exists round smallint,
 add column if not exists ref_event bigint references public.pto_workflow_events(id);
create index if not exists pto_workflow_events_ref_idx on public.pto_workflow_events(ref_event);
comment on column public.pto_workflow_events.event_date is 'Дата, введённая пользователем: сдача объёмов, передача, подписание, получение комплекта.';
comment on column public.pto_workflow_events.source is 'Чьё замечание: технадзор, заказчик, ПТО, бухгалтерия, система.';
comment on column public.pto_workflow_events.round is 'Номер круга замечаний на шаге.';
comment on column public.pto_workflow_events.ref_event is 'note_off — какое замечание снято; undo — какой переход отменён.';

-- 2. Шаги. Старые порядковые номера сдвигаются, чтобы не мешать новым.
alter table public.pto_workflow_steps drop constraint pto_workflow_steps_requires_check;
alter table public.pto_workflow_steps add constraint pto_workflow_steps_requires_check
 check (requires <@ array['kit','person','method','proof','files','accept','acts','subs','received']);
comment on column public.pto_workflow_steps.requires is 'Условия перехода НА шаг: kit — состав и суммы комплекта, acts — есть акты С-2, subs — субподрядчики месяца прошли технадзор или исключены, received — комплект получен, person/method/proof — кому, как, подтверждение, files — файл у каждой версии, accept — фиксация принятых версий.';
update public.pto_workflow_steps set ordinal=ordinal+100;

insert into public.pto_workflow_steps(template_code,code,ordinal,label,actor,requires,hint) values
 ('claim','wait',1,'Ждём объёмы','pto','{}','Прораб сдаёт объёмы за месяц.'),
 ('claim','acts',2,'Готовятся акты','pto','{}','ПТО готовит акты С-2а и передаёт технадзору.'),
 ('claim','tn',3,'У технадзора','pto','{acts}','Технадзор подтверждает нашу часть и субподрядчиков; собираем комплект для заказчика.'),
 ('claim','check',4,'На проверке','pto','{kit,subs,method,proof}','Комплект у заказчика. Отметьте дату подписания.'),
 ('sub_claim','wait',1,'Ждём процентовку','pto','{}','Субподрядчик подаёт процентовку технадзору.'),
 ('sub_claim','tn',2,'У технадзора','pto','{}','Субподрядчик защищает процентовку у технадзора сам.'),
 ('sub_claim','check',3,'На проверке у ПТО','pto','{}','Отметьте получение комплекта и проверьте его.'),
 ('c29','wait',1,'Ждём акты','pto','{}','С-29 формируется по актам месяца.'),
 ('c29','acts',2,'Формирует ПТО','pto','{}','ПТО формирует нормативный расход и передаёт прорабу.'),
 ('c29','tn',3,'У прораба','pto','{kit,person}','Прораб вносит фактический расход и объяснения отклонений.'),
 ('c29','check',4,'Проверка ПТО','pto','{}','ПТО проверяет отклонения.'),
 ('c29','signed',5,'Проверено','pto','{kit}','Передайте С-29 в бухгалтерию.');
update public.pto_workflow_steps set ordinal=5,label='Проверено',actor='pto',requires='{}',hint='Заказчик подписал. Передайте оригиналы в бухгалтерию со сканами.'
 where template_code='claim' and code='signed';
update public.pto_workflow_steps set ordinal=4,label='Проверено',actor='pto',requires='{kit,received}',hint='ПТО проверило. Субподрядчик несёт бумагу на подпись.'
 where template_code='sub_claim' and code='signed';
update public.pto_workflow_steps set ordinal=case template_code when 'sub_claim' then 5 else 6 end,label='В бухгалтерии',actor='none',
 requires=case template_code when 'sub_claim' then '{kit,files,person,proof,accept}'::text[] else '{kit,files,person,accept}'::text[] end,
 hint='Оригиналы переданы в бухгалтерию, сумма зафиксирована.'
 where code='accepted';

-- Комплекты переходят на новые шаги по таблице соответствия docs/conveyor.md.
alter table public.pto_workflows drop constraint pto_workflows_template_code_step_code_fkey;
update public.pto_workflows set step_code=case template_code
 when 'claim' then case step_code when 'prepared' then 'acts' when 'site' then 'acts' when 'supervision' then 'tn' when 'customer' then 'check'
  when 'signed' then 'signed' else 'accepted' end
 when 'sub_claim' then case step_code when 'received' then 'check' when 'review' then 'check' when 'agreed' then 'signed' when 'signed' then 'signed' else 'accepted' end
 else case step_code when 'formation' then 'acts' when 'site' then 'tn' when 'review' then 'check' when 'checked' then 'signed' else 'accepted' end
end,updated_at=now()
where step_code not in ('wait','acts','tn','check','signed','accepted');
-- Передача в бухгалтерию фиксирует принятые версии (раньше это делал шаг «Принято бухгалтерией»).
update public.pto_documents d set accepted_version=d.current_version
from public.pto_workflow_documents wd join public.pto_workflows w on w.id=wd.workflow_id
where wd.document_id=d.id and w.step_code='accepted' and d.accepted_version is distinct from d.current_version;
delete from public.pto_workflow_steps where code not in ('wait','acts','tn','check','signed','accepted');
alter table public.pto_workflows add constraint pto_workflows_template_code_step_code_fkey
 foreign key(template_code,step_code) references public.pto_workflow_steps(template_code,code);

-- 3. Снятое ожидание: ожидаемая карточка (договор за месяц без комплекта) убирается с доски с причиной.
create table public.pto_workflow_skips (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 period_id uuid not null,
 contract_id uuid not null,
 template_code text not null references public.pto_workflow_templates(code) on delete restrict,
 reason text not null check (length(trim(reason))>=3),
 note text not null default '',
 actor uuid not null references public.pto_profiles(id),
 created_at timestamptz not null default now(),
 foreign key(period_id,project_id) references public.pto_periods(id,project_id),
 foreign key(contract_id,project_id) references public.pto_contracts(id,project_id),
 unique(period_id,contract_id,template_code)
);
create index pto_workflow_skips_project_idx on public.pto_workflow_skips(project_id);
create index pto_workflow_skips_contract_idx on public.pto_workflow_skips(contract_id,project_id);
create index pto_workflow_skips_actor_idx on public.pto_workflow_skips(actor);
create index pto_workflow_skips_template_idx on public.pto_workflow_skips(template_code);
alter table public.pto_workflow_skips enable row level security;
revoke all on public.pto_workflow_skips from anon, authenticated;
grant select on public.pto_workflow_skips to authenticated;
create policy scoped_read on public.pto_workflow_skips for select to authenticated using (coalesce(pto_private.can_read(project_id),false));

-- 4. Вспомогательные функции.
-- Чего не хватает нашей процентовке по субподрядчикам (null — все прошли технадзор или исключены).
create or replace function pto_private.subs_problem(wf_id uuid) returns text
language sql stable security definer set search_path='' as $$
 with wf as (select w.*,p.month from public.pto_workflows w join public.pto_periods p on p.id=w.period_id where w.id=wf_id),
 subs as (
  select c.id,coalesce(c.party,c.number) name from public.pto_contract_list c,wf
  where c.project_id=wf.project_id and c.direction='incoming'
   and (c.contract_date is null or c.contract_date<=(wf.month+interval '1 month'-interval '1 day')::date)
   and (c.current_end_date is null or c.current_end_date>=wf.month)
 ),
 lagging as (
  select s.name from subs s,wf
  where not exists(select 1 from public.pto_workflow_skips k where k.period_id=wf.period_id and k.contract_id=s.id and k.template_code='sub_claim')
   and not exists(select 1 from public.pto_workflows x join public.pto_workflow_steps st on st.template_code=x.template_code and st.code=x.step_code
    where x.period_id=wf.period_id and x.contract_id=s.id and x.template_code='sub_claim' and st.ordinal>=3)
 )
 select case when count(*)>0 then 'Технадзор не подтвердил субподрядчиков: '||string_agg(name,', ' order by name)||'. Дождитесь или исключите из месяца с причиной' end from lagging;
$$;

-- Документ попадает в комплект своего маршрута. Комплект назад не возвращается:
-- до проверки — запись в истории, на проверке и после — замечание; переданный в бухгалтерию комплект не меняется.
create or replace function pto_private.workflow_link(doc_id uuid, actor_id uuid, reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.pto_documents; tpl text; wf public.pto_workflows; st public.pto_workflow_steps; start_step text; c29 public.pto_workflows; fresh boolean;
begin
 select * into d from public.pto_documents where id=doc_id;
 tpl:=pto_private.workflow_template_for(d.kind,(select direction from public.pto_contracts where id=d.contract_id));
 select code into start_step from public.pto_workflow_steps where template_code=tpl and ordinal=2;
 insert into public.pto_workflows(template_code,project_id,period_id,contract_id,step_code)
 values(tpl,d.project_id,d.period_id,d.contract_id,start_step)
 on conflict(period_id,contract_id,template_code) do nothing;
 select * into wf from public.pto_workflows where period_id=d.period_id and contract_id=d.contract_id and template_code=tpl for update;
 fresh:=not exists(select 1 from public.pto_workflow_events where workflow_id=wf.id);
 if fresh then
  insert into public.pto_workflow_events(workflow_id,kind,to_step,actor,note) values(wf.id,'created',wf.step_code,actor_id,'Комплект создан');
 end if;
 if wf.step_code='accepted' then raise exception 'Комплект передан в бухгалтерию: чтобы изменить документы, отмените переход'; end if;
 insert into public.pto_workflow_documents(workflow_id,document_id) values(wf.id,d.id) on conflict do nothing;
 select * into st from public.pto_workflow_steps where template_code=wf.template_code and code=wf.step_code;
 if not fresh then
  -- Изменение после отправки заказчику, после получения комплекта субподрядчика или после проверки — замечание.
  if wf.step_code='signed' or (wf.step_code='check' and (wf.template_code='claim'
   or (wf.template_code='sub_claim' and exists(select 1 from public.pto_workflow_events where workflow_id=wf.id and kind='received')))) then
   insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,source,round,note)
   values(wf.id,'note',wf.step_code,wf.step_code,actor_id,d.id,'система',
    (select count(*)+1 from public.pto_workflow_events e where e.workflow_id=wf.id and e.kind='note' and e.from_step=wf.step_code),
    case when wf.template_code='claim' then 'Комплект изменён после отправки заказчику: ' else 'Комплект изменён после получения: ' end||reason);
  else
   insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,note)
   values(wf.id,'revised',wf.step_code,wf.step_code,actor_id,d.id,reason);
  end if;
 end if;
 -- С-29 строится по актам: при изменении актов отмечается «основание изменилось».
 if d.kind in ('c2a','c2b') then
  select * into c29 from public.pto_workflows where period_id=d.period_id and contract_id=d.contract_id and template_code='c29' for update;
  if found and c29.step_code in ('tn','check','signed') then
   insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,source,round,note)
   values(c29.id,'note',c29.step_code,c29.step_code,actor_id,d.id,'система',
    (select count(*)+1 from public.pto_workflow_events e where e.workflow_id=c29.id and e.kind='note' and e.from_step=c29.step_code),
    'Основание изменилось: '||reason);
  end if;
 end if;
 return wf.id;
end $$;

-- Период месяца объекта: открывается при первом действии, закрытый не принимает изменений.
create or replace function pto_private.month_period(project uuid, month_value date) returns public.pto_periods
language plpgsql security definer set search_path='' as $$
declare per public.pto_periods;
begin
 if month_value is null or month_value<>date_trunc('month',month_value)::date then raise exception 'Укажите месяц'; end if;
 insert into public.pto_periods(project_id,month) values(project,month_value) on conflict(project_id,month) do nothing;
 select * into per from public.pto_periods where project_id=project and month=month_value for update;
 if per.status<>'open' then raise exception 'Период закрыт'; end if;
 return per;
end $$;

-- 5. Команды маршрута.
create or replace function pto_private.workflow_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op';
 wf public.pto_workflows; per public.pto_periods; cur public.pto_workflow_steps; nxt public.pto_workflow_steps;
 con public.pto_contracts; tpl text; problem text; result jsonb; prior pto_private.requests; ev public.pto_workflow_events;
 project uuid; doc uuid; ref bigint;
 person_value text:=trim(coalesce(body->>'person','')); method_value text:=trim(coalesce(body->>'method',''));
 proof_value text:=trim(coalesce(body->>'proof','')); note_value text:=trim(coalesce(body->>'note',''));
 source_value text:=trim(coalesce(body->>'source','')); date_value date;
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
 if role_name not in ('head','engineer') then raise exception 'Шаги выполняет ПТО' using errcode='42501'; end if;
 date_value:=coalesce(nullif(body->>'date','')::date,current_date);
 if date_value>current_date then raise exception 'Дата не может быть позже сегодняшней'; end if;

 -- Ожидаемая карточка: начать маршрут или снять ожидание. Комплекта ещё нет.
 if op in ('workflow_start','workflow_skip','workflow_unskip') then
  project:=(body->>'project_id')::uuid; tpl:=body->>'template_code';
  if not coalesce(pto_private.can_access(project),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid and project_id=project;
  if not found then raise exception 'Договор не относится к объекту'; end if;
  if tpl is null or tpl not in ('claim','sub_claim','c29') or (tpl='sub_claim')<>(con.direction='incoming') then raise exception 'Маршрут не подходит договору'; end if;
  per:=pto_private.month_period(project,(body->>'month')::date);
  if op='workflow_unskip' then
   delete from public.pto_workflow_skips where period_id=per.id and contract_id=con.id and template_code=tpl;
   if not found then raise exception 'Ожидание не снималось'; end if;
  elsif exists(select 1 from public.pto_workflows where period_id=per.id and contract_id=con.id and template_code=tpl) then
   raise exception 'Комплект за месяц уже есть';
  elsif exists(select 1 from public.pto_workflow_skips where period_id=per.id and contract_id=con.id and template_code=tpl) then
   raise exception 'Ожидание снято: сначала верните его';
  elsif op='workflow_skip' then
   if length(trim(coalesce(body->>'reason','')))<3 then raise exception 'Укажите причину'; end if;
   insert into public.pto_workflow_skips(project_id,period_id,contract_id,template_code,reason,note,actor)
   values(project,per.id,con.id,tpl,trim(body->>'reason'),note_value,who);
  else
   select * into nxt from public.pto_workflow_steps where template_code=tpl and ordinal=2;
   insert into public.pto_workflows(template_code,project_id,period_id,contract_id,step_code) values(tpl,project,per.id,con.id,nxt.code) returning * into wf;
   insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,event_date,person,note)
   values(wf.id,'start','wait',nxt.code,who,date_value,person_value,note_value);
  end if;
  update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id;
  insert into public.pto_events(project_id,period_id,actor,action,detail) values(project,per.id,who,op,body);
  result:=jsonb_build_object('project_id',project,'period_id',per.id,'workflow_id',wf.id);
  insert into pto_private.requests values(req,who,body,result);
  return result;
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
 nxt:=cur;

 if op='workflow_advance' then
  if cur.actor='none' then raise exception 'Маршрут завершён'; end if;
  if exists(select 1 from public.pto_workflow_events n where n.workflow_id=wf.id and n.kind='note'
   and not exists(select 1 from public.pto_workflow_events o where o.ref_event=n.id and o.kind='note_off')) then
   raise exception 'Есть открытое замечание: снимите его, когда исправят';
  end if;
  select * into nxt from public.pto_workflow_steps where template_code=wf.template_code and ordinal=cur.ordinal+1;
  if 'acts'=any(nxt.requires) and not exists(select 1 from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
   where wd.workflow_id=wf.id and d.kind in ('c2a','c2b')) then raise exception 'В комплекте нет актов С-2'; end if;
  if 'kit'=any(nxt.requires) then
   problem:=pto_private.kit_problem(wf.id);
   if problem is not null then raise exception '%',problem; end if;
  end if;
  if 'subs'=any(nxt.requires) then
   problem:=pto_private.subs_problem(wf.id);
   if problem is not null then raise exception '%',problem; end if;
  end if;
  if 'received'=any(nxt.requires) and not exists(select 1 from public.pto_workflow_events where workflow_id=wf.id and kind='received') then
   raise exception 'Сначала отметьте «Комплект получен»';
  end if;
  if 'person'=any(nxt.requires) and length(person_value)<2 then raise exception 'Укажите, кому передан комплект'; end if;
  if 'method'=any(nxt.requires) and length(method_value)=0 then raise exception 'Укажите способ передачи'; end if;
  if 'proof'=any(nxt.requires) and length(proof_value)<3 then
   raise exception '%',case when wf.template_code='claim' then 'Укажите номер письма или другое подтверждение отправки' else 'Отметьте, что бумага подписана с обеих сторон' end;
  end if;
  if 'files'=any(nxt.requires) and exists(
   select 1 from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
   where wd.workflow_id=wf.id and not exists(select 1 from public.pto_files f where f.version_id=d.current_version)
  ) then raise exception 'Приложите скан к каждому документу комплекта'; end if;
  if 'accept'=any(nxt.requires) then
   -- Передача в бухгалтерию фиксирует сумму: текущие версии комплекта становятся принятыми.
   update public.pto_documents d set accepted_version=d.current_version
   from public.pto_workflow_documents wd where wd.workflow_id=wf.id and wd.document_id=d.id;
  end if;
  update public.pto_workflows set step_code=nxt.code,updated_at=now() where id=wf.id;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,event_date,person,method,proof,note)
  values(wf.id,'advance',cur.code,nxt.code,who,date_value,person_value,method_value,proof_value,note_value);

 elsif op='workflow_undo' then
  -- Отмена ошибочного перехода: последний переход комплекта, отменяет нажавший или начальник ПТО.
  select * into ev from public.pto_workflow_events where workflow_id=wf.id and kind in ('start','advance','undo') order by id desc limit 1;
  if not found or ev.kind='undo' or ev.to_step<>wf.step_code then raise exception 'Отменять нечего'; end if;
  if ev.actor is distinct from who and role_name<>'head' then raise exception 'Отменить переход может нажавший или начальник ПТО' using errcode='42501'; end if;
  if length(note_value)<3 then raise exception 'Укажите, почему отменяете'; end if;
  select * into nxt from public.pto_workflow_steps where template_code=wf.template_code and code=ev.from_step;
  if cur.code='accepted' then
   update public.pto_documents d set accepted_version=null
   from public.pto_workflow_documents wd where wd.workflow_id=wf.id and wd.document_id=d.id and d.accepted_version=d.current_version;
  end if;
  update public.pto_workflows set step_code=nxt.code,updated_at=now() where id=wf.id;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,ref_event,note)
  values(wf.id,'undo',cur.code,nxt.code,who,ev.id,note_value);

 elsif op='workflow_received' then
  if wf.template_code<>'sub_claim' or cur.code<>'check' then raise exception 'Получение комплекта отмечается на проверке у ПТО'; end if;
  if exists(select 1 from public.pto_workflow_events where workflow_id=wf.id and kind='received') then raise exception 'Получение уже отмечено'; end if;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,event_date,note)
  values(wf.id,'received',cur.code,cur.code,who,date_value,note_value);

 elsif op='workflow_note' then
  if cur.actor='none' then raise exception 'Комплект передан в бухгалтерию'; end if;
  if length(note_value)<3 then raise exception 'Опишите замечание'; end if;
  if source_value not in ('технадзор','заказчик','ПТО','бухгалтерия','прораб') then raise exception 'Укажите, чьё замечание'; end if;
  doc:=nullif(body->>'document_id','')::uuid;
  if doc is not null and not exists(select 1 from public.pto_workflow_documents where workflow_id=wf.id and document_id=doc) then
   raise exception 'Документ не входит в комплект';
  end if;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,event_date,document_id,source,person,round,note)
  values(wf.id,'note',cur.code,cur.code,who,date_value,doc,source_value,person_value,
   (select count(*)+1 from public.pto_workflow_events e where e.workflow_id=wf.id and e.kind='note' and e.from_step=cur.code),note_value);

 elsif op='workflow_note_off' then
  ref:=(body->>'event_id')::bigint;
  if not exists(select 1 from public.pto_workflow_events where id=ref and workflow_id=wf.id and kind='note') then raise exception 'Замечание не найдено'; end if;
  if exists(select 1 from public.pto_workflow_events where ref_event=ref and kind='note_off') then raise exception 'Замечание уже снято'; end if;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,event_date,ref_event,note)
  values(wf.id,'note_off',cur.code,cur.code,who,date_value,ref,note_value);

 elsif op='workflow_return' then
  raise exception 'Комплект назад не возвращается: добавьте замечание или отмените ошибочный переход';
 else
  raise exception 'Неизвестная операция';
 end if;

 update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id;
 insert into public.pto_events(project_id,period_id,document_id,actor,action,detail)
 values(wf.project_id,wf.period_id,doc,who,op,body || jsonb_build_object('from',cur.code,'to',nxt.code,'template',wf.template_code));
 result:=jsonb_build_object('workflow_id',wf.id,'project_id',wf.project_id,'period_id',wf.period_id,'step',nxt.code);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;

revoke all on function pto_private.subs_problem(uuid), pto_private.month_period(uuid,date) from public, anon, authenticated;
revoke all on function pto_private.workflow_command(uuid,jsonb), pto_private.workflow_link(uuid,uuid,text) from public, anon, authenticated;
grant execute on function pto_private.workflow_command(uuid,jsonb) to authenticated;

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
  when payload->>'op' in ('workflow_advance','workflow_return','workflow_undo','workflow_note','workflow_note_off','workflow_received',
   'workflow_start','workflow_skip','workflow_unskip') then pto_private.workflow_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;

-- 6. Список комплектов: открытые замечания, даты пройденных шагов, последний переход, получение комплекта.
create or replace view public.pto_workflow_list with(security_invoker=true) as
select w.*,t.name template_name,t.money,t.ordinal template_ordinal,s.label step_label,s.ordinal step_ordinal,s.actor,s.hint,
 (select max(x.ordinal) from public.pto_workflow_steps x where x.template_code=w.template_code) last_ordinal,
 pr.name project,c.number contract_number,coalesce(cp.short_name,c.party_text) party,per.month,
 (select count(*) from public.pto_workflow_documents wd where wd.workflow_id=w.id)::int documents,
 (select coalesce(sum(v.amount),0) from public.pto_workflow_documents wd join public.pto_documents d on d.id=wd.document_id
  join public.pto_versions v on v.id=d.current_version where wd.workflow_id=w.id and d.kind in ('c2a','c2b'))::numeric(18,2) acts_amount,
 le.created_at last_event_at,le.kind last_event_kind,le.note last_note,
 case when le.kind in ('return','reset') then le.document_id end attention_document_id,
 coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'source',n.source,'person',n.person,'round',n.round,
   'date',coalesce(n.event_date,n.created_at::date),'step',n.from_step,'document_id',n.document_id) order by n.id)
  from public.pto_workflow_events n where n.workflow_id=w.id and n.kind='note'
  and not exists(select 1 from public.pto_workflow_events o where o.ref_event=n.id and o.kind='note_off')),'[]'::jsonb) open_notes,
 coalesce((select jsonb_object_agg(m.from_step,coalesce(m.event_date,m.created_at::date)) from (
   select distinct on (a.from_step) a.from_step,a.event_date,a.created_at from public.pto_workflow_events a
   where a.workflow_id=w.id and a.kind in ('start','advance') and a.from_step is not null
    and not exists(select 1 from public.pto_workflow_events u where u.ref_event=a.id and u.kind='undo')
   order by a.from_step,a.id desc) m),'{}'::jsonb) step_dates,
 lm.created_at step_since,lm.kind last_move_kind,lm.actor last_move_actor,
 (select coalesce(r.event_date,r.created_at::date) from public.pto_workflow_events r where r.workflow_id=w.id and r.kind='received' order by r.id desc limit 1) received_on
from public.pto_workflows w
join public.pto_workflow_templates t on t.code=w.template_code
join public.pto_workflow_steps s on s.template_code=w.template_code and s.code=w.step_code
join public.pto_projects pr on pr.id=w.project_id
join public.pto_periods per on per.id=w.period_id
join public.pto_contracts c on c.id=w.contract_id
left join public.pto_counterparties cp on cp.id=c.counterparty_id
left join lateral (select e.* from public.pto_workflow_events e where e.workflow_id=w.id order by e.id desc limit 1) le on true
left join lateral (select e.* from public.pto_workflow_events e where e.workflow_id=w.id and e.kind in ('created','start','advance','undo') order by e.id desc limit 1) lm on true;
revoke all on public.pto_workflow_list from anon, authenticated;
grant select on public.pto_workflow_list to authenticated;
