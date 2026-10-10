-- Загрузка договоров из файла pto-contracts v1 (сканы и Word-реестры папки ДОГОВОРА), тред «Вкладка «Месяц» в объекте», 10.10.2026.
-- Пользователь выбирает объекты галочками в предпросмотре; загрузка создаёт недостающие объекты, контрагентов с УНП,
-- договоры, допсоглашения и части договора. Существующий договор (тот же объект, номер и направление) дополняется:
-- заполняются только пустые поля, введённое вручную не перезаписывается.
-- Новые поля договора:
-- * contract_type: su22_sub (СУ-22 — субподрядчик), su22_mps (СУ-22 — МПС), mps_customer (МПС — заказчик, справочно),
--   mps_su22_sub (трёхсторонний, справочно). Справочные договоры не участвуют в «Подписании» и месяце;
-- * checked: false у договоров, собранных из реестров и имён файлов (низкая уверенность), пока инженер не отметит «Проверен».
--   Непроверенные договоры тоже не создают ожидания в «Подписании»;
-- * source_key (путь папки в ДОГОВОРА, ключ повторной загрузки), doc_status, replaced_by, note, files (пути сканов),
--   advance_current_percent, advance_target_amount.
-- Откат: supabase/rollback/20261011000000_contracts_import.down.sql

alter table public.pto_contracts
 add column contract_type text check (contract_type in ('su22_sub','su22_mps','mps_customer','mps_su22_sub')),
 add column checked boolean not null default true,
 add column source_key text check (length(source_key) <= 500),
 add column doc_status text check (doc_status in ('draft','signed_one_side','signed')),
 add column replaced_by text not null default '',
 add column note text not null default '',
 add column files jsonb not null default '[]'::jsonb check (jsonb_typeof(files)='array'),
 add column advance_current_percent numeric(5,2) check (advance_current_percent between 0 and 100),
 add column advance_target_amount numeric(18,2) check (advance_target_amount >= 0);
create unique index pto_contracts_source_key_key on public.pto_contracts(source_key) where source_key is not null;

-- Список договоров: прежний расчёт + новые поля (c.* раскрывается при создании представления).
drop view public.pto_contract_list;
create view public.pto_contract_list with(security_invoker=true) as
select c.*,
 coalesce(cp.short_name,c.party_text) party,
 coalesce(am.amount_after,c.initial_amount) current_amount,
 case when am.id is not null then am.vat_amount else c.vat_amount end current_vat_amount,
 coalesce(te.work_end_date,c.work_end_date) current_end_date,
 am.number amount_addendum_number, am.agreement_date amount_addendum_date,
 te.number term_addendum_number, te.agreement_date term_addendum_date,
 (select count(*) from public.pto_contract_addenda a where a.contract_id=c.id and a.status='signed')::int signed_addenda
from public.pto_contracts c
left join public.pto_counterparties cp on cp.id=c.counterparty_id
left join lateral (select a.* from public.pto_contract_addenda a where a.contract_id=c.id and a.status='signed' and a.amount_after is not null
 order by a.agreement_date desc,a.created_at desc limit 1) am on true
left join lateral (select a.* from public.pto_contract_addenda a where a.contract_id=c.id and a.status='signed' and a.work_end_date is not null
 order by a.agreement_date desc,a.created_at desc limit 1) te on true;
revoke all on public.pto_contract_list from anon, authenticated;
grant select on public.pto_contract_list to authenticated;

create or replace function pto_private.contract_import_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; op text:=body->>'op'; prior pto_private.requests; result jsonb;
 it jsonb; ad jsonb; pt jsonb; con public.pto_contracts; proj uuid; cp uuid; v_unp text; v_name text; v_number text; v_dir text;
 v_our text; v_cpr text; created_projects int:=0; created_parties int:=0; created int:=0; updated int:=0; addenda int:=0; parts int:=0;
 skipped jsonb:='[]'::jsonb; ad_skipped int:=0; v_start date; v_end date; is_new boolean; ord int;
 -- Счётчики одного договора: попадают в итог, только если договор загрузился (ошибка откатывает его целиком).
 n_proj int; n_party int; n_add int; n_add_skip int; n_parts int;
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

 -- Отметка «Проверен» у договора.
 if op='set_contract_checked' then
  if role_name not in ('head','engineer') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid for update;
  if not found then raise exception 'Договор не найден'; end if;
  if not coalesce(pto_private.can_access(con.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
  update public.pto_contracts set checked=coalesce((body->>'checked')::boolean,true) where id=con.id;
  insert into public.pto_events(project_id,actor,action,detail) values(con.project_id,who,op,body);
  result:=jsonb_build_object('contract_id',con.id);
  insert into pto_private.requests values(req,who,body,result);
  return result;
 end if;

 -- Загрузка: создаёт объекты, поэтому только начальник ПТО.
 if role_name<>'head' then raise exception 'Загружать договоры может начальник ПТО' using errcode='42501'; end if;
 if jsonb_typeof(body->'contracts')<>'array' then raise exception 'Нет списка договоров'; end if;

 for it in select * from jsonb_array_elements(body->'contracts') loop
  n_proj:=0;n_party:=0;n_add:=0;n_add_skip:=0;n_parts:=0;
  begin
   -- Объект по названию; нет — создаётся.
   v_name:=trim(coalesce(it->>'object',''));
   if length(v_name) not between 1 and 120 then raise exception 'нет названия объекта'; end if;
   select id into proj from public.pto_projects where lower(trim(name))=lower(v_name) order by created_at limit 1;
   if proj is null then
    insert into public.pto_projects(name,full_name,address) values(v_name,v_name,'') returning id into proj;
    insert into public.pto_events(project_id,actor,action,detail) values(proj,who,'create_project',jsonb_build_object('name',v_name,'source','import_contracts'));
    n_proj:=1;
   end if;

   -- Контрагент: по УНП (нет в справочнике — создаётся), без УНП — по названию, иначе текстом в договоре.
   cp:=null;v_unp:=nullif(trim(coalesce(it->>'unp','')),'');
   v_name:=trim(coalesce(nullif(it->>'party',''),it->>'party_full_name',''));
   if v_unp is not null and v_unp ~ '^[0-9]{9}$' then
    select id into cp from public.pto_counterparties where unp=v_unp;
    if cp is null then
     insert into public.pto_counterparties(unp,short_name,full_name,source)
     values(v_unp,left(v_name,200),left(coalesce(nullif(trim(it->>'party_full_name'),''),v_name),500),'contracts_import') returning id into cp;
     n_party:=1;
    end if;
   elsif length(v_name)>0 then
    select id into cp from public.pto_counterparties where lower(short_name)=lower(v_name) or lower(full_name)=lower(v_name) order by created_at limit 1;
   end if;

   v_our:=it->>'our_role';v_cpr:=it->>'counterparty_role';
   if not ((v_our='contractor' and v_cpr='customer') or (v_our='subcontractor' and v_cpr in ('general_contractor','customer'))
    or (v_our='customer' and v_cpr='subcontractor')) then raise exception 'несовместимые роли сторон'; end if;
   v_dir:=case when v_cpr in ('customer','general_contractor') then 'outgoing' else 'incoming' end;
   v_number:=coalesce(nullif(trim(it->>'number'),''),'б/н');
   v_start:=nullif(it->>'work_start','')::date;v_end:=nullif(it->>'work_end','')::date;
   if v_start is not null and v_end is not null and v_end<v_start then v_end:=null; end if;

   -- Существующий договор: по ключу папки, иначе по объекту, номеру и направлению.
   con:=null;
   select * into con from public.pto_contracts where source_key=it->>'key';
   if con.id is null then select * into con from public.pto_contracts where project_id=proj and number=v_number and direction=v_dir; end if;
   is_new:=con.id is null;
   if is_new then
    if cp is null and length(v_name)=0 then raise exception 'нет контрагента'; end if;
    insert into public.pto_contracts(project_id,number,party_text,counterparty_id,contract_date,subject,our_role,counterparty_role,
     initial_amount,vat_rate,vat_amount,work_start_date,work_end_date,contract_type,checked,source_key,doc_status,replaced_by,note,files,
     advance_current_percent,advance_target_amount)
    values(proj,v_number,case when cp is null then left(v_name,200) end,cp,nullif(it->>'date','')::date,left(coalesce(it->>'subject',''),1000),v_our,v_cpr,
     pto_private.money_arg(it->>'amount','цена'),pto_private.money_arg(it->>'vat_rate','ставка НДС'),pto_private.money_arg(it->>'vat_amount','НДС'),
     v_start,v_end,it->>'type',coalesce((it->>'checked')::boolean,false),it->>'key',nullif(it->>'status',''),coalesce(it->>'replaced_by',''),coalesce(it->>'note',''),
     coalesce(it->'files','[]'::jsonb),pto_private.money_arg(it->>'advance_current_percent','аванс, %'),pto_private.money_arg(it->>'advance_target_amount','целевой аванс'))
    returning * into con;
   else
    if con.project_id<>proj then raise exception 'договор с этим ключом уже есть на другом объекте'; end if;
    update public.pto_contracts set
     counterparty_id=coalesce(counterparty_id,cp),contract_date=coalesce(contract_date,nullif(it->>'date','')::date),
     subject=case when length(subject)=0 then left(coalesce(it->>'subject',''),1000) else subject end,
     initial_amount=coalesce(initial_amount,pto_private.money_arg(it->>'amount','цена')),vat_rate=coalesce(vat_rate,pto_private.money_arg(it->>'vat_rate','ставка НДС')),
     vat_amount=coalesce(vat_amount,pto_private.money_arg(it->>'vat_amount','НДС')),
     work_start_date=coalesce(work_start_date,case when work_end_date is null or v_start<=work_end_date then v_start end),
     work_end_date=coalesce(work_end_date,case when coalesce(work_start_date,v_start) is null or v_end>=coalesce(work_start_date,v_start) then v_end end),
     contract_type=coalesce(contract_type,it->>'type'),source_key=coalesce(source_key,it->>'key'),doc_status=coalesce(doc_status,nullif(it->>'status','')),
     replaced_by=case when length(replaced_by)=0 then coalesce(it->>'replaced_by','') else replaced_by end,
     note=case when length(note)=0 then coalesce(it->>'note','') else note end,
     files=case when files='[]'::jsonb then coalesce(it->'files','[]'::jsonb) else files end,
     advance_current_percent=coalesce(advance_current_percent,pto_private.money_arg(it->>'advance_current_percent','аванс, %')),
     advance_target_amount=coalesce(advance_target_amount,pto_private.money_arg(it->>'advance_target_amount','целевой аванс'))
    where id=con.id returning * into con;
   end if;
   if cp is not null then
    insert into public.pto_counterparty_roles(counterparty_id,role) values(cp,v_cpr) on conflict do nothing;
    if v_cpr in ('customer','general_contractor','subcontractor') then
     insert into public.pto_project_participants(project_id,counterparty_id,role) values(proj,cp,v_cpr) on conflict(project_id,counterparty_id,role) do nothing;
    end if;
   end if;

   -- Допсоглашения: новые по номеру; без номера или даты не загружаются. Подписанным считается всё, кроме signed=false.
   for ad in select * from jsonb_array_elements(coalesce(it->'addenda','[]'::jsonb)) loop
    if nullif(trim(ad->>'number'),'') is null or nullif(ad->>'date','') is null then n_add_skip:=n_add_skip+1; continue; end if;
    if exists(select 1 from public.pto_contract_addenda where contract_id=con.id and number=trim(ad->>'number')) then continue; end if;
    insert into public.pto_contract_addenda(contract_id,number,agreement_date,amount_after,vat_amount,work_end_date,note,status)
    values(con.id,trim(ad->>'number'),(ad->>'date')::date,pto_private.money_arg(ad->>'amount_after','цена после ДС'),pto_private.money_arg(ad->>'vat_amount_after','НДС после ДС'),
     nullif(ad->>'work_end_after','')::date,left(coalesce(ad->>'note',''),1000),case when (ad->>'signed')='false' then 'draft' else 'signed' end);
    n_add:=n_add+1;
   end loop;

   -- Части договора: только если частей две и больше и у договора их ещё нет.
   if jsonb_array_length(coalesce(it->'parts','[]'::jsonb))>1 and not exists(select 1 from public.pto_contract_parts where contract_id=con.id) then
    ord:=0;
    for pt in select * from jsonb_array_elements(it->'parts') loop
     ord:=ord+1;
     insert into public.pto_contract_parts(project_id,contract_id,name,vat_rate,amount,ordinal,created_by)
     values(proj,con.id,left(coalesce(nullif(trim(pt->>'name'),''),'Часть '||ord),200),pto_private.money_arg(pt->>'vat_rate','ставка НДС части'),pto_private.money_arg(pt->>'amount','стоимость части'),ord,who);
     n_parts:=n_parts+1;
    end loop;
   end if;
   insert into public.pto_events(project_id,actor,action,detail)
   values(proj,who,'import_contract',jsonb_build_object('key',it->>'key','number',v_number,'new',is_new,'contract_id',con.id));
   if is_new then created:=created+1; else updated:=updated+1; end if;
   created_projects:=created_projects+n_proj;created_parties:=created_parties+n_party;addenda:=addenda+n_add;ad_skipped:=ad_skipped+n_add_skip;parts:=parts+n_parts;
  exception when others then
   skipped:=skipped||jsonb_build_array(jsonb_build_object('key',it->>'key','reason',sqlerrm));
  end;
 end loop;

 -- Основной договор (для ДС-договоров и трёхсторонних): по номеру на том же объекте, если ещё не указан.
 for it in select * from jsonb_array_elements(body->'contracts') loop
  if nullif(trim(it->>'parent_number'),'') is not null then
   update public.pto_contracts c set parent_contract_id=(select p.id from public.pto_contracts p
    where p.project_id=c.project_id and p.number=trim(it->>'parent_number') and p.id<>c.id order by (p.direction='outgoing') desc,p.created_at limit 1)
   where c.source_key=it->>'key' and c.parent_contract_id is null;
  end if;
 end loop;

 result:=jsonb_build_object('projects',created_projects,'parties',created_parties,'created',created,'updated',updated,'addenda',addenda,
  'addenda_skipped',ad_skipped,'parts',parts,'skipped',skipped);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.contract_import_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.contract_import_command(uuid,jsonb) to authenticated;

-- Диспетчер: прежний (20261010235000) + загрузка договоров и отметка «Проверен».
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
  when payload->>'op' in ('set_sub_month','set_month_marks','set_document_mark','check_file') then pto_private.month_command(request_id,payload)
  when payload->>'op'='set_contract_part' then pto_private.part_command(request_id,payload)
  when payload->>'op' in ('import_contracts','set_contract_checked') then pto_private.contract_import_command(request_id,payload)
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
