-- Шаг 5 плана: модель справки С-3а и оперативная оценка выполнения (бриф, разделы 2, 3, 8.1).
-- * С-3а: СМР с НДС = сумма принятых актов (акты с НДС), вручную — выделенный НДС, оборудование, зачёт целевого и текущего аванса;
--   «к оплате» и колонки «с начала года» / «с начала работ» вычисляются (представление pto_c3a_report);
-- * С-29 не имеет денежной суммы;
-- * оперативная оценка хранится отдельно (pto_estimates, только добавление) и показывается в реестре как предварительная;
-- * реестр помечает основание суммы: по принятой С-3а или по актам (пока С-3а не принята).
-- Откат: supabase/rollback/20261005221550_c3a_and_estimates.down.sql

-- 1. Поля справки С-3а в версии документа (версии неизменяемы: новые значения — новая версия).
alter table public.pto_versions
 add column smr_vat numeric(18,2) check (smr_vat is null or smr_vat>=0),
 add column equipment_amount numeric(18,2) check (equipment_amount is null or equipment_amount>=0),
 add column equipment_vat numeric(18,2) check (equipment_vat is null or equipment_vat>=0),
 add column advance_target_offset numeric(18,2) check (advance_target_offset is null or advance_target_offset>=0),
 add column advance_current_offset numeric(18,2) check (advance_current_offset is null or advance_current_offset>=0);
comment on column public.pto_versions.amount is 'С-2а/С-2б: сумма акта с НДС. С-3а: СМР с НДС за период = сумма принятых актов договора (вычисляется). С-29: 0.';
comment on column public.pto_versions.smr_vat is 'С-3а: НДС в составе СМР за период, как в справке (по накоплению, не пересчитывается).';

-- 2. Команды документов: сумма С-3а вычисляется, С-29 без суммы, поля С-3а сохраняются в версии.
create or replace function pto_private.command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op'; project uuid; pid uuid; did uuid; vid uuid;
 per public.pto_periods; doc public.pto_documents; ver public.pto_versions; con public.pto_contracts;
 outgoing public.pto_documents; incoming public.pto_documents;
 result jsonb; prior pto_private.requests; next_state text; amount numeric(16,2); data jsonb; target uuid;
begin
 if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 -- A small team: serialize commands, ensuring close/reopen and mutations cannot interleave.
 perform pg_advisory_xact_lock(722022);
 role_name:=pto_private.my_role();
 if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
 if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;
 select * into prior from pto_private.requests where id=req;
 if found then
  if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
  return prior.result;
 end if;
 if op='create_project' then
  if role_name not in ('head','admin') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  insert into public.pto_projects(name,address) values(trim(body->>'name'),coalesce(body->>'address','')) returning id into project;
 elsif op='member' then
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
 else
  if op in ('create_contract','open_period') then
   project:=(body->>'project_id')::uuid;
  else
   pid:=(body->>'period_id')::uuid;
   select * into per from public.pto_periods where id=pid for update;
   if not found then raise exception 'Период не найден'; end if;
   project:=per.project_id;
  end if;
  if not coalesce(pto_private.can_access(project),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  if op='create_contract' then
   if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
   insert into public.pto_contracts(project_id,number,party,direction) values(project,trim(body->>'number'),trim(body->>'party'),body->>'direction');
  elsif op='open_period' then
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
    if exists(select 1 from public.pto_documents where period_id=pid and (status<>'accepted' or current_version is distinct from accepted_version)) then raise exception 'Есть непринятые версии документов'; end if;
    if exists(select 1 from unnest(per.required_kinds) k where not exists(select 1 from public.pto_documents d where d.period_id=pid and (d.kind=k or (k='act' and d.kind in ('c2a','c2b'))))) then raise exception 'Не сформирован обязательный комплект'; end if;
    if exists(select 1 from public.pto_documents d join public.pto_versions v on v.id=d.current_version where d.period_id=pid and d.kind in ('c3a','c29') and v.sources<>pto_private.sources_for(pid)) then raise exception 'Обновите справку и С-29 по актуальным актам'; end if;
    if exists(select 1 from public.pto_allocations a join public.pto_documents o on o.id=a.outgoing_document join public.pto_documents i on i.id=a.incoming_document where a.period_id=pid and (a.outgoing_version is distinct from o.accepted_version or a.incoming_version is distinct from i.accepted_version)) then raise exception 'Обновите распределение субподряда'; end if;
    if exists(select 1 from public.pto_documents d join public.pto_contracts c on c.id=d.contract_id where d.period_id=pid and c.direction='incoming' and d.kind in ('c2a','c2b') and not exists(select 1 from public.pto_allocations a where a.incoming_document=d.id)) then raise exception 'Не сопоставлен входящий субподряд'; end if;
    if op='review' then
     update public.pto_periods set reviewed_revision=revision,reviewed_by=who where id=pid;
    else
     if per.reviewed_revision is distinct from per.revision then raise exception 'Нужна актуальная проверка начальника ПТО'; end if;
     select jsonb_build_object('register',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.pto_register r where r.period_id=pid),
       'documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.pto_documents d where d.period_id=pid),
       'allocations',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.pto_allocations a where a.period_id=pid)) into data;
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
    if op<>'accept' and role_name not in ('head','engineer') then raise exception 'Нет права редактировать документы' using errcode='42501'; end if;
    if op='create_document' then
     select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid and project_id=project;
     if not found then raise exception 'Договор не относится к объекту'; end if;
     if length(trim(coalesce(body->>'number','')))=0 then raise exception 'Укажите номер'; end if;
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
      -- СМР с НДС не вводится: это сумма принятых актов договора за период (акты С-2 с НДС).
      amount:=(select coalesce(sum(v.amount),0) from public.pto_documents a join public.pto_versions v on v.id=a.accepted_version
       where a.period_id=pid and a.contract_id=doc.contract_id and a.kind in ('c2a','c2b'));
     elsif doc.kind='c29' then
      -- С-29 — материальный документ, денежной суммы нет.
      amount:=0;
     else
      amount:=(body->>'amount')::numeric;
      if amount is null or amount<0 or amount::text='NaN' then raise exception 'Некорректная сумма'; end if;
     end if;
     -- Для С-3а вручную вносятся выделенный НДС, оборудование и зачёт авансов; не переданное поле берётся из прежней версии.
     insert into public.pto_versions(document_id,project_id,version,amount,note,sources,created_by,
      smr_vat,equipment_amount,equipment_vat,advance_target_offset,advance_current_offset)
     values(did,project,coalesce(ver.version,0)+1,amount,coalesce(body->>'note',''),pto_private.sources_for(pid),who,
      case when doc.kind='c3a' then case when body ? 'smr_vat' then pto_private.money_arg(body->>'smr_vat','НДС СМР') else ver.smr_vat end end,
      case when doc.kind='c3a' then case when body ? 'equipment_amount' then pto_private.money_arg(body->>'equipment_amount','оборудование') else ver.equipment_amount end end,
      case when doc.kind='c3a' then case when body ? 'equipment_vat' then pto_private.money_arg(body->>'equipment_vat','НДС оборудования') else ver.equipment_vat end end,
      case when doc.kind='c3a' then case when body ? 'advance_target_offset' then pto_private.money_arg(body->>'advance_target_offset','зачёт целевого аванса') else ver.advance_target_offset end end,
      case when doc.kind='c3a' then case when body ? 'advance_current_offset' then pto_private.money_arg(body->>'advance_current_offset','зачёт текущего аванса') else ver.advance_current_offset end end)
     returning id into vid;
     update public.pto_documents set current_version=vid,status='draft' where id=did;
    elsif op='attach' then
     if doc.status<>'draft' then raise exception 'Прикрепление доступно к черновику'; end if;
     if split_part(body->>'path','/',1)<>project::text or split_part(body->>'path','/',2)<>did::text or split_part(body->>'path','/',3)<>doc.current_version::text then raise exception 'Неверный путь файла'; end if;
     if not exists(select 1 from storage.objects where bucket_id='pto-documents' and name=body->>'path') then raise exception 'Файл ещё не загружен'; end if;
     insert into public.pto_files(project_id,version_id,path,name,uploaded_by) values(project,doc.current_version,body->>'path',body->>'name',who);
    else
     next_state:=case op when 'send' then 'sent' when 'receive' then 'received' when 'sign' then 'signed' when 'accept' then 'accepted' end;
     if next_state is null then raise exception 'Неизвестная операция'; end if;
     if doc.status<>(case op when 'send' then 'draft' when 'receive' then 'sent' when 'sign' then 'received' when 'accept' then 'signed' end) then raise exception 'Недопустимый переход документа'; end if;
     if length(trim(coalesce(body->>'proof','')))<3 or length(trim(coalesce(body->>'person','')))<2 then raise exception 'Укажите участника и подтверждение'; end if;
     if op='send' and (length(trim(coalesce(body->>'method','')))=0 or not exists(select 1 from public.pto_files where version_id=doc.current_version)) then raise exception 'Для отправки нужен файл и способ передачи'; end if;
     if doc.kind in ('c2a','c2b') and ver.amount<=0 then raise exception 'В акте нет суммы выполнения'; end if;
     if doc.kind in ('c3a','c29') and (ver.sources='' or ver.sources<>pto_private.sources_for(pid)) then raise exception 'Обновите версию по принятым актам'; end if;
     if doc.kind='c3a' and ver.amount is distinct from (select coalesce(sum(v.amount),0) from public.pto_documents a join public.pto_versions v on v.id=a.accepted_version where a.period_id=pid and a.contract_id=doc.contract_id and a.kind in ('c2a','c2b')) then raise exception 'Сумма С-3а не совпадает с принятыми актами договора'; end if;
     if op='accept' then
      if role_name not in ('accountant','head') then raise exception 'Принятие доступно бухгалтерии или начальнику ПТО' using errcode='42501'; end if;
      update public.pto_documents set accepted_version=current_version where id=did;
     end if;
     update public.pto_documents set status=next_state where id=did;
    end if;
   end if;
   if op not in ('review','close') then update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=pid; end if;
  end if;
 end if;
 insert into public.pto_events(project_id,period_id,document_id,actor,action,detail) values(project,pid,did,who,op,body);
 result:=jsonb_build_object('project_id',project,'period_id',pid,'document_id',did,'version_id',vid);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.command(uuid,jsonb) from public,anon;
grant execute on function pto_private.command(uuid,jsonb) to authenticated;

-- 3. Справка С-3а: за период, с начала года, с начала работ. Накопление — по принятым С-3а предыдущих месяцев.
create view public.pto_c3a_report with(security_invoker=true) as
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
acc as (select * from v where accepted)
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

-- 4. Оперативная оценка выполнения до подписания актов: отдельно от принятых сумм, с историей.
create table public.pto_estimates (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 period_id uuid not null,
 contract_id uuid not null,
 amount numeric(18,2) not null check (amount>=0),
 note text not null default '',
 created_by uuid not null references public.pto_profiles(id),
 created_at timestamptz not null default now(),
 foreign key(period_id,project_id) references public.pto_periods(id,project_id),
 foreign key(contract_id,project_id) references public.pto_contracts(id,project_id)
);
comment on table public.pto_estimates is 'Оперативная оценка выполнения (предварительно). Действует последняя запись по периоду и договору.';
create index pto_estimates_current_idx on public.pto_estimates(period_id,contract_id,created_at desc);
create index pto_estimates_project_id_idx on public.pto_estimates(project_id);
create index pto_estimates_contract_project_idx on public.pto_estimates(contract_id,project_id);
create index pto_estimates_period_project_idx on public.pto_estimates(period_id,project_id);
create index pto_estimates_created_by_idx on public.pto_estimates(created_by);
alter table public.pto_estimates enable row level security;
revoke all on public.pto_estimates from anon, authenticated;
grant select on public.pto_estimates to authenticated;
create policy scoped_read on public.pto_estimates for select to authenticated using (pto_private.can_access(project_id));
create trigger pto_estimates_append_only before update or delete on public.pto_estimates for each row execute function pto_private.forbid_change();
create trigger pto_estimates_no_truncate before truncate on public.pto_estimates for each statement execute function pto_private.forbid_change();

create or replace function pto_private.estimate_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; per public.pto_periods; con public.pto_contracts;
 value numeric; target uuid; result jsonb; prior pto_private.requests;
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
 if body->>'op'<>'set_estimate' then raise exception 'Неизвестная операция'; end if;
 select * into per from public.pto_periods where id=(body->>'period_id')::uuid for update;
 if not found then raise exception 'Период не найден'; end if;
 if not coalesce(pto_private.can_access(per.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 if per.status<>'open' then raise exception 'Период закрыт'; end if;
 select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid and project_id=per.project_id;
 if not found or con.direction<>'outgoing' then raise exception 'Оценка вводится по договору с заказчиком этого объекта'; end if;
 value:=pto_private.money_arg(body->>'amount','оценка выполнения');
 if value is null then raise exception 'Укажите сумму оценки'; end if;
 insert into public.pto_estimates(project_id,period_id,contract_id,amount,note,created_by)
 values(per.project_id,per.id,con.id,value,trim(coalesce(body->>'note','')),who) returning id into target;
 insert into public.pto_events(project_id,period_id,actor,action,detail) values(per.project_id,per.id,who,'set_estimate',body);
 result:=jsonb_build_object('project_id',per.project_id,'period_id',per.id,'estimate_id',target);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.estimate_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.estimate_command(uuid,jsonb) to authenticated;

-- 5. Реестр: основание суммы (С-3а или акты) и оперативная оценка отдельной колонкой.
create or replace function public.pto_register_matrix(p_month date) returns jsonb
language sql stable set search_path='' as $$
with reg0 as (
 select r.period_id,r.project_id,r.contract_id,r.total::numeric(18,2) total,r.subcontract::numeric(18,2) subcontract
 from public.pto_register r where r.month=p_month
),
est as (
 select distinct on (e.period_id,e.contract_id) e.period_id,e.project_id,e.contract_id,e.amount
 from public.pto_estimates e join public.pto_periods p on p.id=e.period_id
 where p.month=p_month
 order by e.period_id,e.contract_id,e.created_at desc,e.id desc
),
reg as (
 select coalesce(r.period_id,e.period_id) period_id,coalesce(r.project_id,e.project_id) project_id,c.id contract_id,c.number,
  coalesce(r.total,0)::numeric(18,2) total,coalesce(r.subcontract,0)::numeric(18,2) subcontract,e.amount estimate
 from reg0 r
 full join est e on e.period_id=r.period_id and e.contract_id=r.contract_id
 join public.pto_contracts c on c.id=coalesce(r.contract_id,e.contract_id)
 where coalesce(r.total,0)<>0 or coalesce(r.subcontract,0)<>0 or coalesce(e.amount,0)<>0
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
 select reg.project_id,p.name project,reg.contract_id,reg.number,reg.total,reg.subcontract,(reg.total-reg.subcontract)::numeric(18,2) own,reg.estimate,
  case when reg.total=0 then null
   when exists(select 1 from public.pto_documents d join public.pto_versions v on v.id=d.accepted_version
    where d.period_id=reg.period_id and d.contract_id=reg.contract_id and d.kind='c3a' and d.status='accepted' and v.amount=reg.total) then 'c3a'
   else 'acts' end basis,
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

-- 6. Диспетчер команд.
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
  when payload->>'op' in ('create_process','transition_process') then pto_private.process_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
