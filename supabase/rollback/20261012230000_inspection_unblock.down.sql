-- Откат 20261012230000_inspection_unblock: прежние функции из 20261005224629_workflows, 20261008220000_signing_steps,
-- 20261011210000_document_card, 20261012210000_add_missing_to_accepted, 20261012003500_auto_c3a_smr_vat,
-- 20261010235000_sent_and_contract_parts и 20261012170000_signed_cumulative_redate.
-- Отметки частей у справок С-3а и пересчитанные версии остаются в журнале (он только на добавление).

drop trigger if exists pto_document_marks_c3a_part on public.pto_document_marks;
drop function if exists pto_private.c3a_part_changed();

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

revoke all on function pto_private.subs_problem(uuid) from public, anon, authenticated;

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
 if wf.step_code='accepted' then
  -- Недостающий документ (например, С-3а после актов) добавляется в переданный комплект и сразу считается переданным.
  -- Документы, уже лежащие в комплекте, меняются только после отмены перехода.
  if exists(select 1 from public.pto_workflow_documents where workflow_id=wf.id and document_id=d.id)
   or (d.kind='c3a' and exists(select 1 from public.pto_workflow_documents x join public.pto_documents o on o.id=x.document_id
    where x.workflow_id=wf.id and o.kind='c3a' and o.current_version is not null)) then
   raise exception 'Комплект передан в бухгалтерию: чтобы изменить документы, отмените переход';
  end if;
  insert into public.pto_workflow_documents(workflow_id,document_id) values(wf.id,d.id);
  update public.pto_documents set accepted_version=current_version where id=d.id;
  insert into public.pto_workflow_events(workflow_id,kind,from_step,to_step,actor,document_id,note)
  values(wf.id,'revised',wf.step_code,wf.step_code,actor_id,d.id,reason||' (после передачи в бухгалтерию)');
  return wf.id;
 end if;
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


CREATE OR REPLACE FUNCTION pto_private.command(req uuid, body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if role_name<>'head' then raise exception 'Только начальник ПТО' using errcode='42501'; end if;
  project:=(body->>'project_id')::uuid; target:=(body->>'user_id')::uuid;
  if coalesce((body->>'remove')::boolean,false) then delete from public.pto_memberships where project_id=project and user_id=target;
  else insert into public.pto_memberships values(project,target) on conflict do nothing; end if;
 elsif op='profile' then
  if role_name<>'head' then raise exception 'Только начальник ПТО' using errcode='42501'; end if;
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
    if role_name<>'head' or per.status<>'closed' then raise exception 'Повторное открытие закрытого периода доступно начальнику ПТО' using errcode='42501'; end if;
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
     if coalesce((body->>'correction')::boolean,false) and body->>'kind' not in ('c2a','c2b') then raise exception 'Корректировкой может быть только акт С-2'; end if;
     insert into public.pto_documents(project_id,period_id,contract_id,kind,number,due_date,correction,corrects)
     values(project,pid,con.id,body->>'kind',trim(body->>'number'),nullif(body->>'due_date','')::date,
      coalesce((body->>'correction')::boolean,false),trim(coalesce(body->>'corrects',''))) returning * into doc;
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
      if amount is null or amount::text='NaN' then raise exception 'Некорректная сумма акта'; end if;
      -- Ноль и минус — только у акта-корректировки (решение пользователя 11.10.2026).
      if amount<=0 and not doc.correction then raise exception 'Сумма ноль или меньше бывает только у акта-корректировки'; end if;
     end if;
     insert into public.pto_versions(document_id,project_id,version,amount,note,sources,created_by,
      smr_vat,equipment_amount,equipment_vat,advance_target_offset,advance_current_offset)
     values(did,project,coalesce(ver.version,0)+1,amount,coalesce(body->>'note',''),pto_private.kit_sources(pid,doc.contract_id),who,
      case when doc.kind='c3a' then case when body ? 'smr_vat' then pto_private.money_arg(body->>'smr_vat','НДС СМР') else ver.smr_vat end
       -- Акт: НДС в составе суммы, как в файле; у корректировки может быть минус. Новая версия без НДС — НДС не указан.
       when doc.kind in ('c2a','c2b') then pto_private.vat_arg(body->>'smr_vat') end,
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
     -- Скан прикладывается и к комплекту в бухгалтерии: оригинал передан, скан — для контроля ПТО (AGENTS.md §2), суммы не меняет.
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
end $function$;

revoke all on function pto_private.command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.command(uuid,jsonb) to authenticated;

create or replace function pto_private.set_c3a_smr_vat()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  doc_kind text;
  pid uuid;
  cid uuid;
begin
  select d.kind,d.period_id,d.contract_id
    into doc_kind,pid,cid
    from public.pto_documents d
   where d.id=new.document_id;

  if doc_kind='c3a' then
    select coalesce(sum(coalesce(v.smr_vat,round(v.amount/6,2))),0)::numeric(18,2)
      into new.smr_vat
      from public.pto_documents a
      join public.pto_versions v on v.id=a.current_version
     where a.period_id=pid
       and a.contract_id=cid
       and a.kind in ('c2a','c2b');
  end if;

  return new;
end
$$;

revoke all on function pto_private.set_c3a_smr_vat() from public,anon,authenticated;

drop view if exists public.pto_c3a_report;
create or replace view public.pto_c3a_report with(security_invoker=true) as
with v as (
 select v.id version_id,d.id document_id,d.project_id,d.period_id,d.contract_id,d.number,p.month,v.version,
  d.accepted_version=v.id accepted,d.current_version=v.id is_current,
  v.amount::numeric(18,2) smr,
  coalesce(v.smr_vat,0)::numeric(18,2) smr_vat,
  coalesce(v.equipment_amount,0)::numeric(18,2) equipment,
  coalesce(v.equipment_vat,0)::numeric(18,2) equipment_vat,
  coalesce(v.advance_target_offset,0)::numeric(18,2) target_offset,
  coalesce(v.advance_current_offset,0)::numeric(18,2) current_offset
 from public.pto_versions v
 join public.pto_documents d on d.id=v.document_id
 join public.pto_periods p on p.id=d.period_id
 where d.kind='c3a'
),
-- Накопление: прошлый месяц входит с шага «Проверено» (текущая версия), до него — только принятая бухгалтерией версия.
acc as (
 select v.* from v join public.pto_documents d on d.id=v.document_id
 where v.version_id=case when exists(select 1 from public.pto_workflow_documents wd join public.pto_workflows w on w.id=wd.workflow_id
   where wd.document_id=d.id and w.step_code in ('signed','accepted','closed')) then d.current_version else d.accepted_version end
)
select v.*,
 (v.smr+v.equipment-v.target_offset-v.current_offset)::numeric(18,2) to_pay,
 (y.smr+v.smr)::numeric(18,2) ytd_smr,
 (y.smr_vat+v.smr_vat)::numeric(18,2) ytd_smr_vat,
 (y.equipment+v.equipment)::numeric(18,2) ytd_equipment,
 (y.equipment_vat+v.equipment_vat)::numeric(18,2) ytd_equipment_vat,
 (y.target_offset+v.target_offset)::numeric(18,2) ytd_target_offset,
 (y.current_offset+v.current_offset)::numeric(18,2) ytd_current_offset,
 (y.smr+v.smr+y.equipment+v.equipment-y.target_offset-v.target_offset-y.current_offset-v.current_offset)::numeric(18,2) ytd_to_pay,
 (s.smr+v.smr)::numeric(18,2) total_smr,
 (s.smr_vat+v.smr_vat)::numeric(18,2) total_smr_vat,
 (s.equipment+v.equipment)::numeric(18,2) total_equipment,
 (s.equipment_vat+v.equipment_vat)::numeric(18,2) total_equipment_vat,
 (s.target_offset+v.target_offset)::numeric(18,2) total_target_offset,
 (s.current_offset+v.current_offset)::numeric(18,2) total_current_offset,
 (s.smr+v.smr+s.equipment+v.equipment-s.target_offset-v.target_offset-s.current_offset-v.current_offset)::numeric(18,2) total_to_pay
from v
cross join lateral (select coalesce(sum(a.smr),0) smr,coalesce(sum(a.smr_vat),0) smr_vat,coalesce(sum(a.equipment),0) equipment,coalesce(sum(a.equipment_vat),0) equipment_vat,coalesce(sum(a.target_offset),0) target_offset,coalesce(sum(a.current_offset),0) current_offset from acc a where a.contract_id=v.contract_id and a.month<v.month and a.month>=date_trunc('year',v.month)::date) y
cross join lateral (select coalesce(sum(a.smr),0) smr,coalesce(sum(a.smr_vat),0) smr_vat,coalesce(sum(a.equipment),0) equipment,coalesce(sum(a.equipment_vat),0) equipment_vat,coalesce(sum(a.target_offset),0) target_offset,coalesce(sum(a.current_offset),0) current_offset from acc a where a.contract_id=v.contract_id and a.month<v.month) s;

revoke all on public.pto_c3a_report from anon, authenticated;
grant select on public.pto_c3a_report to authenticated;

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
-- Части договора: сумма актов по части (как «всего» договора: по С-3а — принятые версии, иначе подписанные).
parts as (
 select reg.period_id,reg.contract_id,pt.id part_id,pt.name,pt.vat_rate,pt.ordinal,sum(v.amount)::numeric(18,2) total
 from reg
 join public.pto_documents d on d.period_id=reg.period_id and d.contract_id=reg.contract_id and d.kind in ('c2a','c2b')
 join public.pto_document_marks_current dm on dm.document_id=d.id
 join public.pto_contract_parts pt on pt.id=dm.part_id
 join public.pto_versions v on v.id=case when reg.basis='c3a' then d.accepted_version else d.current_version end
 where reg.basis is not null
 group by 1,2,3,4,5,6
),
single as (
 select period_id from public.pto_register where month=p_month group by period_id having count(*)=1
),
-- Субподряд в их ценах (D): акты субподрядчиков объекта за месяц. Договор с заказчиком у объекта один (решение 10.10.2026).
-- Если исходящих договоров несколько, колонки по-прежнему из сопоставления (pto_allocations).
cells as (
 select d.period_id,reg.contract_id out_contract,d.contract_id in_contract,sum(v.amount)::numeric(18,2) amount
 from public.pto_documents d
 join public.pto_contracts ic on ic.id=d.contract_id and ic.direction='incoming'
 join public.pto_versions v on v.id=d.current_version
 join single s on s.period_id=d.period_id
 join reg on reg.period_id=d.period_id
 where d.kind in ('c2a','c2b')
 group by 1,2,3
 having sum(v.amount)<>0
 union all
 select a.period_id,o.contract_id,i.contract_id,sum(a.amount)::numeric(18,2)
 from public.pto_allocations a
 join public.pto_documents o on o.id=a.outgoing_document
 join public.pto_documents i on i.id=a.incoming_document
 join reg on reg.period_id=a.period_id and reg.contract_id=o.contract_id
 where a.period_id not in (select period_id from single)
 group by 1,2,3
 having sum(a.amount)<>0
),
-- «На заказчика» (F): из отметки субподрядчика за месяц, иначе из сопоставления.
fcells as (
 select r.period_id,r.contract_id out_contract,sm.contract_id in_contract,sm.on_customer amount
 from public.pto_sub_month_current sm
 join single s on s.period_id=sm.period_id
 join reg r on r.period_id=sm.period_id
 where sm.on_customer is not null
 union all
 select a.period_id,o.contract_id,i.contract_id,sum(a.amount)::numeric(18,2)
 from public.pto_allocations a
 join public.pto_documents o on o.id=a.outgoing_document
 join public.pto_documents i on i.id=a.incoming_document
 join reg on reg.period_id=a.period_id and reg.contract_id=o.contract_id
 where not exists(select 1 from public.pto_sub_month_current sm join single s on s.period_id=sm.period_id
  where sm.period_id=a.period_id and sm.contract_id=i.contract_id and sm.on_customer is not null)
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
  coalesce((select jsonb_object_agg(c.in_contract,c.amount::text) from cells c where c.period_id=reg.period_id and c.out_contract=reg.contract_id),'{}'::jsonb) cells,
  coalesce((select jsonb_object_agg(c.in_contract,c.amount::text) from fcells c where c.period_id=reg.period_id and c.out_contract=reg.contract_id),'{}'::jsonb) customer_cells
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
 'rows',coalesce((select jsonb_agg(x.j order by x.project,x.project_id,x.ord,x.number,x.sub) from (
   select rc.project,rc.project_id,0 ord,rc.number,pt.ordinal sub,jsonb_build_object('kind','part','project_id',rc.project_id,'project',rc.project,'contract_id',rc.contract_id,
    'number',rc.number,'part_id',pt.part_id,'part',pt.name,'vat_rate',pt.vat_rate::text,'total',pt.total::text) j
   from rows_c rc join reg on reg.contract_id=rc.contract_id join parts pt on pt.period_id=reg.period_id and pt.contract_id=rc.contract_id
   union all
   select rc.project,rc.project_id,0,rc.number,2147483646,jsonb_build_object('kind','part','project_id',rc.project_id,'project',rc.project,'contract_id',rc.contract_id,
    'number',rc.number,'part_id',null,'part','Часть не указана','vat_rate',null,'total',(rc.total-s.total)::text)
   from rows_c rc join reg on reg.contract_id=rc.contract_id
   join (select period_id,contract_id,sum(total) total from parts group by 1,2) s on s.period_id=reg.period_id and s.contract_id=rc.contract_id
   where rc.total<>s.total
   union all
   select project,project_id,0 ord,number,2147483647 sub,jsonb_build_object('kind','contract','project_id',project_id,'project',project,'contract_id',contract_id,'number',number,
    'total',total::text,'own',own::text,'subcontract',subcontract::text,'estimate',estimate::text,'basis',basis,'cells',cells,'customer_cells',customer_cells,'has_parts',exists(select 1 from parts p join reg r on r.period_id=p.period_id where p.contract_id=rows_c.contract_id)) j from rows_c
   union all
   select project,project_id,1,'',0,jsonb_build_object('kind','project','project_id',project_id,'project',project,
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

drop function if exists pto_private.c3a_amount(uuid);
drop function if exists pto_private.doc_sources(uuid);
drop function if exists pto_private.doc_part(uuid);
