-- Откат миграции 20261005215002_register_matrix.sql: удаляет функцию расчёта реестра. Таблицы не затрагивались.
-- После выполнения удалить запись версии 20261005215002 из supabase_migrations.schema_migrations.
drop function if exists public.pto_register_matrix(date);
