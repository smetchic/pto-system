alter table public.pto_contracts
  add column if not exists smr_amount numeric check (smr_amount is null or smr_amount >= 0),
  add column if not exists smr_vat_amount numeric check (smr_vat_amount is null or smr_vat_amount >= 0),
  add column if not exists pnr_amount numeric check (pnr_amount is null or pnr_amount >= 0),
  add column if not exists pnr_vat_amount numeric check (pnr_vat_amount is null or pnr_vat_amount >= 0);

comment on column public.pto_contracts.initial_amount is 'Общая договорная цена. Для реестра выполнения не использовать напрямую, если заполнена разбивка СМР/ПНР/оборудование.';
comment on column public.pto_contracts.smr_amount is 'Договорная стоимость строительно-монтажных работ. Именно этот контур участвует в реестре выполнения.';
comment on column public.pto_contracts.pnr_amount is 'Договорная стоимость пусконаладочных работ. Учитывается отдельно от СМР.';
comment on column public.pto_contracts.equipment_amount is 'Договорная стоимость оборудования. Не включается в реестр выполнения; контролируется отдельно по ТТН.';

create table if not exists public.pto_equipment_ttn (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pto_projects(id) on delete cascade,
  contract_id uuid not null references public.pto_contracts(id) on delete cascade,
  ttn_number text not null check (length(trim(ttn_number)) between 1 and 120),
  ttn_date date not null,
  amount numeric not null check (amount >= 0),
  vat_amount numeric null check (vat_amount is null or vat_amount >= 0),
  sent_to_accounting_at timestamptz null,
  accounting_received_at timestamptz null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique(contract_id, ttn_number, ttn_date),
  check (accounting_received_at is null or sent_to_accounting_at is not null)
);

create index if not exists pto_equipment_ttn_project_idx on public.pto_equipment_ttn(project_id);
create index if not exists pto_equipment_ttn_contract_idx on public.pto_equipment_ttn(contract_id);
create index if not exists pto_equipment_ttn_accounting_idx on public.pto_equipment_ttn(accounting_received_at, sent_to_accounting_at);

alter table public.pto_equipment_ttn enable row level security;
drop policy if exists equipment_ttn_read on public.pto_equipment_ttn;
create policy equipment_ttn_read on public.pto_equipment_ttn for select using (coalesce(pto_private.can_access(project_id), false));

grant select on public.pto_equipment_ttn to authenticated;
