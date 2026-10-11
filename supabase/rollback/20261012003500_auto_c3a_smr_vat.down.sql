drop trigger if exists pto_versions_c3a_smr_vat on public.pto_versions;
drop function if exists pto_private.set_c3a_smr_vat();
comment on column public.pto_versions.smr_vat is 'С-3а: НДС в составе СМР за период, как в справке.';
