-- Административное удаление ошибочно внесённого акта С-2 / справки С-3а.
-- Фактически применено вручную через Supabase SQL Editor 11.10.2026.
-- Удалять может только начальник ПТО (роль head); закрытый месяц и документ со сканом не удаляются.

create table if not exists pto_private.deleted_documents (
    id bigint generated always as identity primary key,
    document_id uuid not null,
    project_id uuid not null,
    period_id uuid not null,
    deleted_by uuid not null,
    delete_reason text not null,
    deleted_at timestamptz not null default now(),
    snapshot jsonb not null
);

revoke all on pto_private.deleted_documents from public, anon, authenticated;

create or replace function pto_private.forbid_change()
returns trigger
language plpgsql
set search_path=''
as $$
begin
    if current_setting('pto.admin_delete', true) = '1'
       and pto_private.my_role() = 'head'
    then
        if tg_op = 'DELETE' then return old; else return new; end if;
    end if;
    raise exception 'Запись % только на добавление: % запрещено', tg_table_name, tg_op using errcode='42501';
end
$$;

create or replace function pto_private.delete_wrong_document(p_document uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    who uuid := auth.uid();
    role_name text;
    d public.pto_documents;
    per public.pto_periods;
    snap jsonb;
    workflow_ids uuid[];
begin
    if who is null then raise exception 'Требуется вход' using errcode='42501'; end if;
    role_name := pto_private.my_role();
    if role_name is distinct from 'head' then
        raise exception 'Удалять ошибочно внесённые документы может только начальник ПТО' using errcode='42501';
    end if;
    if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'Укажите причину удаления'; end if;

    select * into d from public.pto_documents where id=p_document for update;
    if not found then raise exception 'Документ не найден'; end if;
    if d.kind not in ('c2a','c2b','c3a') then raise exception 'Удалять этой командой можно только акт С-2а/С-2б или справку С-3а'; end if;

    select * into per from public.pto_periods where id=d.period_id for update;
    if per.status='closed' then raise exception 'Отчётный месяц закрыт. Сначала откройте месяц повторно'; end if;

    if exists (
        select 1 from public.pto_files f
        join public.pto_versions v on v.id=f.version_id
        where v.document_id=d.id
    ) then
        raise exception 'У документа есть загруженный скан. Сначала удалите скан';
    end if;

    select array_agg(wd.workflow_id) into workflow_ids
    from public.pto_workflow_documents wd where wd.document_id=d.id;

    select jsonb_build_object(
        'document',to_jsonb(d),
        'versions',coalesce((select jsonb_agg(to_jsonb(v) order by v.version) from public.pto_versions v where v.document_id=d.id),'[]'::jsonb),
        'marks',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.pto_document_marks m where m.document_id=d.id),'[]'::jsonb),
        'workflow_links',coalesce((select jsonb_agg(to_jsonb(wd)) from public.pto_workflow_documents wd where wd.document_id=d.id),'[]'::jsonb),
        'workflow_events',coalesce((select jsonb_agg(to_jsonb(we) order by we.id) from public.pto_workflow_events we where we.document_id=d.id),'[]'::jsonb),
        'allocations',coalesce((select jsonb_agg(to_jsonb(a)) from public.pto_allocations a where a.outgoing_document=d.id or a.incoming_document=d.id),'[]'::jsonb),
        'reason',trim(p_reason)
    ) into snap;

    insert into pto_private.deleted_documents(document_id,project_id,period_id,deleted_by,delete_reason,snapshot)
    values(d.id,d.project_id,d.period_id,who,trim(p_reason),snap);

    perform set_config('pto.admin_delete','1',true);

    delete from public.pto_allocations where outgoing_document=d.id or incoming_document=d.id;
    delete from public.pto_document_marks where document_id=d.id;
    update public.pto_events set document_id=null where document_id=d.id;
    update public.pto_workflow_events set document_id=null where document_id=d.id;
    delete from public.pto_workflow_documents where document_id=d.id;

    update public.pto_documents set current_version=null,accepted_version=null where id=d.id;
    delete from public.pto_versions where document_id=d.id;
    delete from public.pto_documents where id=d.id;

    if workflow_ids is not null then
        delete from public.pto_workflow_events e
        where e.workflow_id=any(workflow_ids)
          and not exists(select 1 from public.pto_workflow_documents wd where wd.workflow_id=e.workflow_id);
        delete from public.pto_workflows w
        where w.id=any(workflow_ids)
          and not exists(select 1 from public.pto_workflow_documents wd where wd.workflow_id=w.id);
    end if;

    update public.pto_periods
    set revision=revision+1,reviewed_revision=null,reviewed_by=null
    where id=d.period_id;

    insert into public.pto_events(project_id,period_id,document_id,actor,action,detail)
    values(d.project_id,d.period_id,null,who,'delete_document',jsonb_build_object(
        'document_id',d.id,'kind',d.kind,'number',d.number,'contract_id',d.contract_id,'reason',trim(p_reason)
    ));

    return jsonb_build_object('deleted',true,'document_id',d.id,'kind',d.kind,'number',d.number);
end
$$;

revoke all on function pto_private.delete_wrong_document(uuid,text) from public, anon, authenticated;

create or replace function public.pto_delete_document(document_id uuid,reason text)
returns jsonb
language sql
security definer
set search_path=''
as $$
    select pto_private.delete_wrong_document(document_id,reason);
$$;

revoke all on function public.pto_delete_document(uuid,text) from public, anon;
grant execute on function public.pto_delete_document(uuid,text) to authenticated;
