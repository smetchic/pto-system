alter table public.pto_contracts
  add column if not exists equipment_amount numeric(16,2),
  add column if not exists equipment_vat_amount numeric(16,2);

alter table public.pto_contracts
  add constraint pto_contracts_equipment_amount_nonnegative check (equipment_amount is null or equipment_amount >= 0),
  add constraint pto_contracts_equipment_vat_amount_nonnegative check (equipment_vat_amount is null or equipment_vat_amount >= 0);
