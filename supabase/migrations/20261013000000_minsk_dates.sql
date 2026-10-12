-- Даты шагов сравниваются с сегодняшним днём по Минску, а не по UTC (инспекция 12.10.2026).
-- Вечером после 21:00 по Минску в UTC ещё «вчера», и дата сегодняшнего дня отклонялась как «позже сегодняшней».
-- Часовой пояс задаётся самим функциям (current_date внутри них — дата по Минску); тела функций не меняются.
-- Если функцию позже пересоздают (create or replace), настройку нужно повторить: тест database.test.mjs это проверяет.
-- Откат: supabase/rollback/20261013000000_minsk_dates.down.sql
alter function pto_private.workflow_command(uuid,jsonb) set timezone to 'Europe/Minsk';
alter function pto_private.workflow_jump_command(uuid,jsonb) set timezone to 'Europe/Minsk';
alter function pto_private.workflow_redate_command(uuid,jsonb) set timezone to 'Europe/Minsk';
alter function pto_private.counterparty_import_command(uuid,jsonb) set timezone to 'Europe/Minsk';
