alter table public.pto_counterparties
  rename column liquidation_date to status_change_date;

comment on column public.pto_counterparties.status_change_date is
  'Дата изменения состояния плательщика из МНС XML (поле DLIKV). Не трактовать автоматически как дату ликвидации.';

create or replace function pto_private.counterparty_command(req uuid, body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  role_name text;
  op text := body->>'op';
  target uuid;
  result jsonb;
  prior pto_private.requests;
  unp_value text := trim(coalesce(body->>'unp',''));
  short_value text := trim(coalesce(body->>'short_name',''));
  full_value text := trim(coalesce(body->>'full_name',''));
  status_change_value text := coalesce(body->>'status_change_date',body->>'liquidation_date','');
begin
  if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
  role_name := pto_private.my_role();
  if role_name is null then raise exception 'Учётная запись не активирована' using errcode='42501'; end if;
  if role_name not in ('head','engineer','admin') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
  if req is null then raise exception 'Отсутствует идентификатор запроса'; end if;

  select * into prior from pto_private.requests where id=req;
  if found then
    if prior.actor<>who or prior.command<>body then raise exception 'Идентификатор запроса уже использован'; end if;
    return prior.result;
  end if;

  if unp_value !~ '^[0-9]{9}$' then raise exception 'УНП должен содержать 9 цифр'; end if;
  if length(short_value)=0 then raise exception 'Укажите краткое наименование'; end if;
  if length(full_value)=0 then raise exception 'Укажите полное наименование'; end if;

  if op='create_counterparty' then
    insert into public.pto_counterparties(
      unp,short_name,full_name,address,registration_date,tax_office_code,tax_office_name,
      status_code,status_name,status_change_date,liquidation_info,phone,email,note,source
    ) values (
      unp_value,short_value,full_value,trim(coalesce(body->>'address','')),
      nullif(body->>'registration_date','')::date,trim(coalesce(body->>'tax_office_code','')),
      trim(coalesce(body->>'tax_office_name','')),trim(coalesce(body->>'status_code','')),
      trim(coalesce(body->>'status_name','')),nullif(status_change_value,'')::date,
      trim(coalesce(body->>'liquidation_info','')),trim(coalesce(body->>'phone','')),
      trim(coalesce(body->>'email','')),trim(coalesce(body->>'note','')),
      trim(coalesce(nullif(body->>'source',''),'manual'))
    ) returning id into target;
  elsif op='update_counterparty' then
    target := (body->>'counterparty_id')::uuid;
    update public.pto_counterparties set
      unp=unp_value,
      short_name=short_value,
      full_name=full_value,
      address=trim(coalesce(body->>'address','')),
      registration_date=nullif(body->>'registration_date','')::date,
      tax_office_code=trim(coalesce(body->>'tax_office_code','')),
      tax_office_name=trim(coalesce(body->>'tax_office_name','')),
      status_code=trim(coalesce(body->>'status_code','')),
      status_name=trim(coalesce(body->>'status_name','')),
      status_change_date=nullif(status_change_value,'')::date,
      liquidation_info=trim(coalesce(body->>'liquidation_info','')),
      phone=trim(coalesce(body->>'phone','')),
      email=trim(coalesce(body->>'email','')),
      note=trim(coalesce(body->>'note','')),
      source=trim(coalesce(nullif(body->>'source',''),source)),
      updated_at=now()
    where id=target;
    if not found then raise exception 'Контрагент не найден'; end if;
    update public.pto_contracts set party=short_value where counterparty_id=target;
  else
    raise exception 'Неизвестная операция';
  end if;

  result := jsonb_build_object('counterparty_id',target);
  insert into pto_private.requests values(req,who,body,result);
  return result;
end $$;

revoke all on function pto_private.counterparty_command(uuid,jsonb) from public,anon,authenticated;
grant execute on function pto_private.counterparty_command(uuid,jsonb) to authenticated;
