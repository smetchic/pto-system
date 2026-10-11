drop function if exists public.pto_delete_document(uuid,text);
drop function if exists pto_private.delete_wrong_document(uuid,text);
drop table if exists pto_private.deleted_documents;

create or replace function pto_private.forbid_change()
returns trigger
language plpgsql
set search_path=''
as $$
begin
 raise exception 'Запись % только на добавление: % запрещено', tg_table_name, tg_op using errcode='42501';
end
$$;
