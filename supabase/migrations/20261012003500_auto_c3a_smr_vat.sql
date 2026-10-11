-- НДС в СМР справки С-3а не вводится вручную.
-- Он рассчитывается из текущих версий актов С-2 того же договора и месяца.
-- Если в акте НДС не сохранён отдельно, для нашей ставки 20% используется сумма с НДС / 6.

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

drop trigger if exists pto_versions_c3a_smr_vat on public.pto_versions;
create trigger pto_versions_c3a_smr_vat
before insert on public.pto_versions
for each row execute function pto_private.set_c3a_smr_vat();

comment on column public.pto_versions.smr_vat is
'Для С-2: НДС акта. Для С-3а: автоматически сумма НДС текущих актов С-2 этого договора и периода; вручную не вводится.';
