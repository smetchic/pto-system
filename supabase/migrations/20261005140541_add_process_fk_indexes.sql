create index if not exists pto_process_events_actor_idx on public.pto_process_events(actor);
create index if not exists pto_process_events_document_idx on public.pto_process_events(document_id);
create index if not exists pto_processes_attention_document_idx on public.pto_processes(attention_document_id);
create index if not exists pto_processes_responsible_user_idx on public.pto_processes(responsible_user);
