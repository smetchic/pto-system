-- Откат миграции 20261005214543_register_matrix.sql: удаляет функцию расчёта реестра. Таблицы не затрагивались.
-- После выполнения удалить запись версии 20261005214543 из supabase_migrations.schema_migrations.
drop function if exists public.pto_register_matrix(date);
