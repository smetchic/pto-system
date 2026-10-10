-- Вкладка «Месяц» (docs/month.md, решения пользователя от 10.10.2026): отметки месяца, которых не было в базе.
-- * субподрядчик в месяце: «подаст», план, статус ТН (у ТН / устно / подписал), «на заказчика», оборудование и зачёт авансов из его С-3а;
-- * отметки объекта на месяц: будет оборудование, будут материалы заказчика;
-- * отметки документа: статус ТН акта, часть объекта, материалы заказчика «в т.ч.», где оригинал;
-- * сверка скана: хэш файла SHA-256 и результат ручной сверки.
-- Все таблицы только на добавление: действует последняя запись, предыдущие — журнал изменений (кто, когда, что).
-- Изменение сумм (план не считается) возвращает проверенный месяц на повторную проверку.
-- Откат: supabase/rollback/20261010210000_month_marks.down.sql

-- 1. Субподрядчик в месяце.
create table public.pto_sub_month (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 period_id uuid not null references public.pto_periods(id) on delete restrict,
 contract_id uuid not null references public.pto_contracts(id) on delete restrict,
 expected boolean not null default true,
 plan numeric(18,2) check (plan>=0),
 tn_status text check (tn_status in ('tn','oral','ok')),
 on_customer numeric(18,2),
 equipment numeric(18,2) check (equipment>=0),
 target_offset numeric(18,2) check (target_offset>=0),
 current_offset numeric(18,2) check (current_offset>=0),
 note text not null default '',
 created_by uuid not null references public.pto_profiles(id),
 created_at timestamptz not null default now()
);
comment on table public.pto_sub_month is 'Субподрядчик в месяце (docs/month.md): действует последняя запись по периоду и договору субподряда.';
create index pto_sub_month_current_idx on public.pto_sub_month(period_id,contract_id,created_at desc);
create index pto_sub_month_project_idx on public.pto_sub_month(project_id);
create index pto_sub_month_contract_idx on public.pto_sub_month(contract_id);
create index pto_sub_month_created_by_idx on public.pto_sub_month(created_by);

-- 2. Отметки объекта на месяц.
create table public.pto_month_marks (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 period_id uuid not null references public.pto_periods(id) on delete restrict,
 equipment_expected boolean not null default false,
 materials_expected boolean not null default false,
 created_by uuid not null references public.pto_profiles(id),
 created_at timestamptz not null default now()
);
comment on table public.pto_month_marks is 'Что будет в месяце (оборудование, материалы заказчика): действует последняя запись по периоду.';
create index pto_month_marks_current_idx on public.pto_month_marks(period_id,created_at desc);
create index pto_month_marks_project_idx on public.pto_month_marks(project_id);
create index pto_month_marks_created_by_idx on public.pto_month_marks(created_by);

-- 3. Отметки документа.
create table public.pto_document_marks (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 document_id uuid not null references public.pto_documents(id) on delete restrict,
 tn_status text check (tn_status in ('prep','tn','remarks','ok')),
 part text not null default '',
 materials numeric(18,2) check (materials>=0),
 original text check (original in ('party','ours','accounting')),
 note text not null default '',
 created_by uuid not null references public.pto_profiles(id),
 created_at timestamptz not null default now()
);
comment on table public.pto_document_marks is 'Статус ТН акта, часть объекта, материалы заказчика, где оригинал: действует последняя запись по документу.';
create index pto_document_marks_current_idx on public.pto_document_marks(document_id,created_at desc);
create index pto_document_marks_project_idx on public.pto_document_marks(project_id);
create index pto_document_marks_created_by_idx on public.pto_document_marks(created_by);

-- 4. Сверка скана с версией документа.
create table public.pto_file_checks (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pto_projects(id) on delete restrict,
 file_id uuid not null references public.pto_files(id) on delete restrict,
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 result text not null check (result in ('ok','mismatch')),
 note text not null default '',
 created_by uuid not null references public.pto_profiles(id),
 created_at timestamptz not null default now(),
 check (result='ok' or length(trim(note))>0)
);
comment on table public.pto_file_checks is 'Ручная сверка скана: хэш файла и результат; расхождение — с комментарием. Действует последняя запись по файлу.';
create index pto_file_checks_current_idx on public.pto_file_checks(file_id,created_at desc);
create index pto_file_checks_project_idx on public.pto_file_checks(project_id);
create index pto_file_checks_created_by_idx on public.pto_file_checks(created_by);

do $$ declare t text; begin
 foreach t in array array['pto_sub_month','pto_month_marks','pto_document_marks','pto_file_checks'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy scoped_read on public.%I for select to authenticated using (coalesce(pto_private.can_read(project_id),false))',t);
  execute format('create trigger %I before update or delete on public.%I for each row execute function pto_private.forbid_change()',t||'_append_only',t);
  execute format('create trigger %I before truncate on public.%I for each statement execute function pto_private.forbid_change()',t||'_no_truncate',t);
 end loop;
end $$;

-- Текущие значения: последняя запись.
create view public.pto_sub_month_current with(security_invoker=true) as
select distinct on (period_id,contract_id) * from public.pto_sub_month order by period_id,contract_id,created_at desc,id desc;
create view public.pto_month_marks_current with(security_invoker=true) as
select distinct on (period_id) * from public.pto_month_marks order by period_id,created_at desc,id desc;
create view public.pto_document_marks_current with(security_invoker=true) as
select distinct on (document_id) * from public.pto_document_marks order by document_id,created_at desc,id desc;
create view public.pto_file_checks_current with(security_invoker=true) as
select distinct on (file_id) * from public.pto_file_checks order by file_id,created_at desc,id desc;
revoke all on public.pto_sub_month_current, public.pto_month_marks_current, public.pto_document_marks_current, public.pto_file_checks_current from anon, authenticated;
grant select on public.pto_sub_month_current, public.pto_month_marks_current, public.pto_document_marks_current, public.pto_file_checks_current to authenticated;

-- 5. Команды. Новая запись = текущая с изменёнными полями: переданный ключ меняет значение (null очищает), непереданный остаётся.
create or replace function pto_private.month_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 who uuid:=auth.uid(); role_name text; per public.pto_periods; con public.pto_contracts; doc public.pto_documents; fil public.pto_files;
 cur_s public.pto_sub_month; cur_m public.pto_month_marks; cur_d public.pto_document_marks;
 op text:=body->>'op'; target uuid; result jsonb; prior pto_private.requests; money_changed boolean:=false;
 v_plan numeric; v_on numeric; v_eq numeric; v_to numeric; v_co numeric; v_mat numeric;
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

 -- Период: прямо из команды или через документ / файл.
 if op in ('set_sub_month','set_month_marks') then
  select * into per from public.pto_periods where id=(body->>'period_id')::uuid for update;
 elsif op='set_document_mark' then
  select * into doc from public.pto_documents where id=(body->>'document_id')::uuid;
  if not found then raise exception 'Документ не найден'; end if;
  select * into per from public.pto_periods where id=doc.period_id for update;
 elsif op='check_file' then
  select * into fil from public.pto_files where id=(body->>'file_id')::uuid;
  if not found then raise exception 'Файл не найден'; end if;
  select d.* into doc from public.pto_versions v join public.pto_documents d on d.id=v.document_id where v.id=fil.version_id;
  select * into per from public.pto_periods where id=doc.period_id for update;
 else
  raise exception 'Неизвестная операция';
 end if;
 if per.id is null then raise exception 'Период не найден'; end if;
 if not coalesce(pto_private.can_access(per.project_id),false) then raise exception 'Нет доступа к объекту' using errcode='42501'; end if;
 if per.status<>'open' then raise exception 'Период закрыт'; end if;

 if op='set_sub_month' then
  select * into con from public.pto_contracts where id=(body->>'contract_id')::uuid and project_id=per.project_id;
  if not found or con.direction<>'incoming' then raise exception 'Нужен договор субподряда этого объекта'; end if;
  select * into cur_s from public.pto_sub_month where period_id=per.id and contract_id=con.id order by created_at desc,id desc limit 1;
  if body ? 'tn_status' and body->>'tn_status' is not null and body->>'tn_status' not in ('tn','oral','ok') then raise exception 'Неизвестный статус технадзора'; end if;
  v_plan:=case when body ? 'plan' then pto_private.money_arg(body->>'plan','план') else cur_s.plan end;
  v_on:=case when body ? 'on_customer' then pto_private.money_arg(body->>'on_customer','сумма «на заказчика»') else cur_s.on_customer end;
  v_eq:=case when body ? 'equipment' then pto_private.money_arg(body->>'equipment','оборудование') else cur_s.equipment end;
  v_to:=case when body ? 'target_offset' then pto_private.money_arg(body->>'target_offset','зачёт целевого аванса') else cur_s.target_offset end;
  v_co:=case when body ? 'current_offset' then pto_private.money_arg(body->>'current_offset','зачёт текущего аванса') else cur_s.current_offset end;
  money_changed:=v_on is distinct from cur_s.on_customer or v_eq is distinct from cur_s.equipment or v_to is distinct from cur_s.target_offset or v_co is distinct from cur_s.current_offset;
  insert into public.pto_sub_month(project_id,period_id,contract_id,expected,plan,tn_status,on_customer,equipment,target_offset,current_offset,note,created_by)
  values(per.project_id,per.id,con.id,
   case when body ? 'expected' then coalesce((body->>'expected')::boolean,false) else coalesce(cur_s.expected,true) end,
   v_plan,case when body ? 'tn_status' then body->>'tn_status' else cur_s.tn_status end,v_on,v_eq,v_to,v_co,
   trim(coalesce(body->>'note','')),who) returning id into target;
 elsif op='set_month_marks' then
  select * into cur_m from public.pto_month_marks where period_id=per.id order by created_at desc,id desc limit 1;
  insert into public.pto_month_marks(project_id,period_id,equipment_expected,materials_expected,created_by)
  values(per.project_id,per.id,
   case when body ? 'equipment_expected' then coalesce((body->>'equipment_expected')::boolean,false) else coalesce(cur_m.equipment_expected,false) end,
   case when body ? 'materials_expected' then coalesce((body->>'materials_expected')::boolean,false) else coalesce(cur_m.materials_expected,false) end,
   who) returning id into target;
 elsif op='set_document_mark' then
  select * into cur_d from public.pto_document_marks where document_id=doc.id order by created_at desc,id desc limit 1;
  if body ? 'tn_status' and body->>'tn_status' is not null and body->>'tn_status' not in ('prep','tn','remarks','ok') then raise exception 'Неизвестный статус технадзора'; end if;
  if body ? 'original' and body->>'original' is not null and body->>'original' not in ('party','ours','accounting') then raise exception 'Неизвестное место оригинала'; end if;
  if body->>'tn_status'='remarks' and length(trim(coalesce(body->>'note','')))=0 then raise exception 'Опишите замечание технадзора'; end if;
  v_mat:=case when body ? 'materials' then pto_private.money_arg(body->>'materials','материалы заказчика') else cur_d.materials end;
  money_changed:=v_mat is distinct from cur_d.materials;
  insert into public.pto_document_marks(project_id,document_id,tn_status,part,materials,original,note,created_by)
  values(per.project_id,doc.id,
   case when body ? 'tn_status' then body->>'tn_status' else cur_d.tn_status end,
   case when body ? 'part' then trim(coalesce(body->>'part','')) else coalesce(cur_d.part,'') end,
   v_mat,case when body ? 'original' then body->>'original' else cur_d.original end,
   trim(coalesce(body->>'note','')),who) returning id into target;
 else
  if coalesce(body->>'result','') not in ('ok','mismatch') then raise exception 'Укажите результат сверки'; end if;
  if coalesce(body->>'sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'Нужен хэш файла SHA-256'; end if;
  if body->>'result'='mismatch' and length(trim(coalesce(body->>'note','')))=0 then raise exception 'Опишите расхождение'; end if;
  insert into public.pto_file_checks(project_id,file_id,sha256,result,note,created_by)
  values(per.project_id,fil.id,body->>'sha256',body->>'result',trim(coalesce(body->>'note','')),who) returning id into target;
 end if;

 if money_changed then update public.pto_periods set revision=revision+1,reviewed_revision=null,reviewed_by=null where id=per.id; end if;
 insert into public.pto_events(project_id,period_id,document_id,actor,action,detail) values(per.project_id,per.id,doc.id,who,op,body);
 result:=jsonb_build_object('project_id',per.project_id,'period_id',per.id,'id',target);
 insert into pto_private.requests values(req,who,body,result);
 return result;
end $$;
revoke all on function pto_private.month_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function pto_private.month_command(uuid,jsonb) to authenticated;

-- 6. Диспетчер команд: прежний (20261008220000) + отметки месяца.
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
  else pto_private.command(request_id,payload)
 end;
end $$;
revoke all on function public.pto_command(uuid,jsonb) from public, anon;
grant execute on function public.pto_command(uuid,jsonb) to authenticated;
