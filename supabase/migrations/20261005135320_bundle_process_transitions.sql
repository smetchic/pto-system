alter table public.pto_process_events add column if not exists person text not null default '';
alter table public.pto_process_events add column if not exists method text not null default '';
alter table public.pto_process_events add column if not exists proof text not null default '';

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
  person_value text:=trim(coalesce(body->>'person',''));
  method_value text:=trim(coalesce(body->>'method',''));
  proof_value text:=trim(coalesce(body->>'proof',''));
  note_value text:=trim(coalesce(body->>'note',''));
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
    if target_bucket in ('site','review','external','accounting','closed') and length(person_value)<2 then
      raise exception 'Укажите, кому передан или кем подтверждён комплект';
    end if;
    if target_bucket in ('external','accounting','closed') and length(proof_value)<3 then
      raise exception 'Укажите подтверждение или основание';
    end if;

    attention:=nullif(body->>'document_id','')::uuid;
    if attention is not null and not exists(select 1 from public.pto_process_documents where process_id=process.id and document_id=attention) then
      raise exception 'Документ не входит в комплект';
    end if;
    if target_bucket='pto' and length(note_value)<3 then raise exception 'Укажите причину возврата'; end if;

    if target_bucket='pto' and attention is not null then
      update public.pto_documents set status='draft' where id=attention;
    elsif target_bucket='accounting' then
      update public.pto_documents d set status='signed'
      from public.pto_process_documents pd
      where pd.process_id=process.id and pd.document_id=d.id and d.status<>'accepted';
    elsif target_bucket='closed' then
      if exists(
        select 1 from public.pto_process_documents pd join public.pto_documents d on d.id=pd.document_id
        where pd.process_id=process.id and d.current_version is null
      ) then raise exception 'В комплекте есть документ без версии'; end if;
      update public.pto_documents d set status='accepted',accepted_version=current_version
      from public.pto_process_documents pd
      where pd.process_id=process.id and pd.document_id=d.id;
    end if;

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

    insert into public.pto_process_events(process_id,actor,from_bucket,to_bucket,document_id,note,person,method,proof)
    values(process.id,who,from_bucket,target_bucket,attention,note_value,person_value,method_value,proof_value);
    insert into public.pto_events(project_id,period_id,document_id,actor,action,detail)
    values(process.project_id,process.period_id,attention,who,'process_transition',jsonb_build_object('process_id',process.id,'from',from_bucket,'to',target_bucket,'note',note_value,'person',person_value,'method',method_value,'proof',proof_value));
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
