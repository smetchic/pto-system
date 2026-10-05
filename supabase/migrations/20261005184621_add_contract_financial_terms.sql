alter table public.pto_contracts
  add column if not exists initial_amount numeric(16,2),
  add column if not exists vat_rate numeric(5,2),
  add column if not exists vat_amount numeric(16,2),
  add column if not exists work_start_date date,
  add column if not exists work_end_date date,
  add column if not exists parent_contract_id uuid references public.pto_contracts(id) on delete set null;

alter table public.pto_contracts
  add constraint pto_contracts_initial_amount_nonnegative check (initial_amount is null or initial_amount >= 0),
  add constraint pto_contracts_vat_rate_range check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100)),
  add constraint pto_contracts_vat_amount_nonnegative check (vat_amount is null or vat_amount >= 0),
  add constraint pto_contracts_work_dates_order check (work_start_date is null or work_end_date is null or work_end_date >= work_start_date);

create index if not exists pto_contracts_parent_contract_id_idx on public.pto_contracts(parent_contract_id);
