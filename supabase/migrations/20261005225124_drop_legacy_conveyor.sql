-- Шаг 6б плана: удаление прежнего конвейера, заменённого маршрутами комплектов (шаг 6).
-- Таблицы pto_processes* больше не читаются и не пишутся ни базой, ни сайтом; их единственный комплект перенесён в pto_workflows.
-- pto_private.sources_for заменена на pto_private.kit_sources и не используется.
-- Откат: supabase/rollback/20261005225124_drop_legacy_conveyor.down.sql
drop table public.pto_process_events;
drop table public.pto_process_documents;
drop table public.pto_processes;
drop function pto_private.sources_for(uuid);
