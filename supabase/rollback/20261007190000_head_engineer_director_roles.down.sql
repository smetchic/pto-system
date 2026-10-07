-- Откат миграции 20261007190000_head_engineer_director_roles.sql: возвращает роли head/engineer/admin,
-- доступ на чтение только к закреплённым объектам и администраторские команды (учётные записи, повторное открытие).
-- Определения взяты из миграций 20261004174232 и 20261005230629.
-- Учётные записи руководителя становятся неактивными инженерами; прежнего администратора нужно назначить заново (op=profile).
-- После выполнения удалить запись версии 20261007190000 из supabase_migrations.schema_migrations.

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
end $function$;

revoke all on function pto_private.command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.command(uuid,jsonb) to authenticated;

drop policy scoped_read on public.pto_allocations;
create policy scoped_read on public.pto_allocations for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_contracts;
create policy scoped_read on public.pto_contracts for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_documents;
create policy scoped_read on public.pto_documents for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy equipment_ttn_read on public.pto_equipment_ttn;
create policy equipment_ttn_read on public.pto_equipment_ttn for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_estimates;
create policy scoped_read on public.pto_estimates for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_events;
create policy scoped_read on public.pto_events for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_files;
create policy scoped_read on public.pto_files for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_periods;
create policy scoped_read on public.pto_periods for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy project_participants_read on public.pto_project_participants;
create policy project_participants_read on public.pto_project_participants for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_projects;
create policy scoped_read on public.pto_projects for select to authenticated using (coalesce(pto_private.can_access(id),false));
drop policy scoped_read on public.pto_snapshots;
create policy scoped_read on public.pto_snapshots for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_versions;
create policy scoped_read on public.pto_versions for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy scoped_read on public.pto_workflows;
create policy scoped_read on public.pto_workflows for select to authenticated using (coalesce(pto_private.can_access(project_id),false));
drop policy addenda_scoped_read on public.pto_contract_addenda;
create policy addenda_scoped_read on public.pto_contract_addenda for select to authenticated using (exists(select 1 from public.pto_contracts c where c.id=pto_contract_addenda.contract_id and pto_private.can_access(c.project_id)));
drop policy scoped_read on public.pto_workflow_documents;
create policy scoped_read on public.pto_workflow_documents for select to authenticated using (exists(select 1 from public.pto_workflows w where w.id=pto_workflow_documents.workflow_id and pto_private.can_access(w.project_id)));
drop policy scoped_read on public.pto_workflow_events;
create policy scoped_read on public.pto_workflow_events for select to authenticated using (exists(select 1 from public.pto_workflows w where w.id=pto_workflow_events.workflow_id and pto_private.can_access(w.project_id)));
drop policy pto_file_read on storage.objects;
create policy pto_file_read on storage.objects for select to authenticated using (bucket_id='pto-documents' and exists(select 1 from public.pto_files f where f.path=objects.name and pto_private.can_access(f.project_id)));

drop policy profile_read on public.pto_profiles;
create policy profile_read on public.pto_profiles for select to authenticated using(id=(select auth.uid()) or (select pto_private.my_role()) in ('head','admin'));
drop policy member_read on public.pto_memberships;
create policy member_read on public.pto_memberships for select to authenticated using(user_id=(select auth.uid()) or (select pto_private.my_role()) in ('head','admin'));

create or replace function pto_private.can_access(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.pto_profiles u where u.id=auth.uid() and u.active and
 (u.role in ('head','admin') or exists(select 1 from public.pto_memberships m where m.project_id=p and m.user_id=u.id)));
$$;
drop function pto_private.can_read(uuid);

update public.pto_profiles set role='engineer',active=false where role='director';
alter table public.pto_profiles drop constraint pto_profiles_role_check;
alter table public.pto_profiles add constraint pto_profiles_role_check check (role in ('head','engineer','admin'));
