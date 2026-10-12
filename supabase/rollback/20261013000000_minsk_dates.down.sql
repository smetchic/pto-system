-- Откат 20261013000000_minsk_dates: функции снова берут часовой пояс сеанса (UTC в Supabase).
alter function pto_private.workflow_command(uuid,jsonb) reset timezone;
alter function pto_private.workflow_jump_command(uuid,jsonb) reset timezone;
alter function pto_private.workflow_redate_command(uuid,jsonb) reset timezone;
alter function pto_private.counterparty_import_command(uuid,jsonb) reset timezone;
