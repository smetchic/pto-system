import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
let db, project, otherProject, period, contract, doc, summary, materials;
const users={head:randomUUID(),engineer:randomUUID(),outsider:randomUUID(),director:randomUUID(),second:randomUUID(),inactive:randomUUID()};
async function as(user) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]); await db.exec('set role authenticated'); }
async function command(payload,request=randomUUID()){const r=await db.query('select public.pto_command($1,$2::jsonb) result',[request,JSON.stringify(payload)]);return r.rows[0].result;}
async function rev(){return (await db.query('select revision from pto_periods where id=$1',[period])).rows[0].revision;}
async function run(op,extra={}){return command({op,period_id:period,expected_revision:await rev(),...extra});}
async function create(kind,number,amount='100.00'){return (await run('create_document',{contract_id:contract,kind,number,amount})).document_id;}
// Маршрут комплекта (шаг 6): документы не переходят по одному, комплект движется по шагам шаблона.
async function docRow(d){return (await db.query('select d.*,wd.workflow_id from pto_documents d join pto_workflow_documents wd on wd.document_id=d.id where d.id=$1',[d])).rows[0];}
async function periodRev(per){return (await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision;}
async function attachFile(d){const r=await docRow(d);const path=`${r.project_id}/${d}/${r.current_version}/${randomUUID()}.pdf`;await db.query("insert into storage.objects(bucket_id,name) values('pto-documents',$1)",[path]);await command({op:'attach',period_id:r.period_id,expected_revision:await periodRev(r.period_id),document_id:d,path,name:'Скан.pdf'});}
async function stepOf(w){return (await db.query('select step_code from pto_workflows where id=$1',[w])).rows[0].step_code;}
const advance=(w,extra={})=>command({op:'workflow_advance',workflow_id:w,person:'Ответственный',method:'Письмом',proof:'Письмо № 412',...extra});
const openNotes=async w=>(await db.query("select open_notes from pto_workflow_list where id=$1",[w])).rows[0].open_notes;
// Прогоняет комплект документа до шага upTo: снимает замечания, отмечает получение, прикладывает сканы (действует текущий пользователь).
async function pass(d,upTo='accepted'){
 const w=(await docRow(d)).workflow_id;
 for(let i=0;i<12&&await stepOf(w)!==upTo;i++){
  for(const n of await openNotes(w))await command({op:'workflow_note_off',workflow_id:w,event_id:n.id});
  const row=(await db.query('select template_code,step_code,received_on from pto_workflow_list where id=$1',[w])).rows[0];
  if(row.template_code==='sub_claim'&&row.step_code==='check'&&!row.received_on)await command({op:'workflow_received',workflow_id:w});
  if(row.step_code==='signed'){
   const docs=(await db.query('select d.id from pto_workflow_documents wd join pto_documents d on d.id=wd.document_id where wd.workflow_id=$1 and not exists(select 1 from pto_files f where f.version_id=d.current_version)',[w])).rows;
   for(const x of docs)await attachFile(x.id);
  }
  await advance(w);
 }
 assert.equal(await stepOf(w),upTo);return w;
}
// Переданный в бухгалтерию комплект меняется только после отмены перехода (начальник ПТО).
async function unlock(d){const w=(await docRow(d)).workflow_id;if(await stepOf(w)==='accepted')await command({op:'workflow_undo',workflow_id:w,note:'Исправление после передачи'});return w;}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const migration of (await readdir(new URL('../supabase/migrations/',import.meta.url))).sort()) await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 for(const [name,id] of Object.entries(users)){await db.query('insert into auth.users values($1,$2)',[id,`${name}@test.invalid`]);if(name!=='inactive')await db.query('update pto_profiles set active=true,role=$2 where id=$1',[id,['engineer','outsider','second'].includes(name)?'engineer':name]);}
});
after(async()=>db?.close());
test('create workspace, object scope, memberships and idempotent commands',async()=>{
 await as(users.head);const req=randomUUID(),payload={op:'create_project',name:'Объект 1'};
 const first=await command(payload,req);assert.deepEqual(await command(payload,req),first);project=first.project_id;
 await assert.rejects(command({...payload,name:'Подмена'},req),/уже использован/);
 otherProject=(await command({op:'create_project',name:'Другой объект'})).project_id;
 await command({op:'member',project_id:project,user_id:users.engineer});
 // Инженер видит все объекты организации, а вносит данные только по закреплённым.
 await as(users.engineer);assert.equal((await db.query('select * from pto_projects')).rows.length,2);
 await assert.rejects(command({op:'open_period',project_id:otherProject,month:'2026-10-01'}),/Нет доступа/);
 await assert.rejects(db.query("update pto_profiles set role='admin' where id=$1",[users.engineer]),/permission denied/);
 await command({op:'create_contract',project_id:project,number:'Д-1',party:'Заказчик',direction:'outgoing'});
 contract=(await db.query('select id from pto_contracts')).rows[0].id;
 period=(await command({op:'open_period',project_id:project,month:'2026-10-01'})).period_id;
});
test('kit route: six steps, dates, remarks as flags, no way back except undo, transfer to accounting fixes the kit',async()=>{
 await as(users.engineer);doc=await create('c2b','1');
 const w=(await docRow(doc)).workflow_id;assert.equal(await stepOf(w),'acts','комплект с актом сразу на «Готовятся акты»');
 await advance(w,{date:'2026-10-03'});assert.equal(await stepOf(w),'tn');
 await assert.rejects(advance(w,{date:'2999-01-01'}),/позже сегодняшней/);
 await assert.rejects(advance(w),/акты и одна С-3а/,'С-3а нужна только для отправки заказчику');
 summary=await create('c3a','1','999');
 assert.equal((await docRow(summary)).workflow_id,w,'С-3а попадает в тот же комплект');
 assert.equal((await db.query('select v.amount from pto_versions v join pto_documents d on d.current_version=v.id where d.id=$1',[summary])).rows[0].amount,'100.00');
 assert.equal(await stepOf(w),'tn','новый документ до отправки не возвращает комплект назад');
 await assert.rejects(command({op:'workflow_advance',workflow_id:w,method:'Письмом',proof:'Письмо № 1',expected_revision:(await rev())-1}),/Данные уже изменились/);
 await assert.rejects(advance(w,{method:''}),/способ передачи/);
 await assert.rejects(advance(w,{proof:''}),/номер письма/);
 await advance(w,{date:'2026-10-06'});assert.equal(await stepOf(w),'check');
 // Замечание заказчика — флажок на том же шаге, переход закрыт, пока замечание не снято.
 await assert.rejects(command({op:'workflow_note',workflow_id:w,source:'сосед',note:'Не тот объём'}),/чьё замечание/);
 await command({op:'workflow_note',workflow_id:w,source:'заказчик',note:'Не тот объём кладки, п. 14',person:'Инженер'});
 let notes=await openNotes(w);assert.deepEqual([notes.length,notes[0].round,notes[0].source],[1,1,'заказчик']);
 await assert.rejects(advance(w),/открытое замечание/);
 await command({op:'workflow_note_off',workflow_id:w,event_id:notes[0].id});
 await assert.rejects(command({op:'workflow_note_off',workflow_id:w,event_id:notes[0].id}),/уже снято/);
 await command({op:'workflow_note',workflow_id:w,source:'заказчик',note:'Повторно: п. 14'});
 notes=await openNotes(w);assert.equal(notes[0].round,2,'второй круг');
 await command({op:'workflow_note_off',workflow_id:w,event_id:notes[0].id});
 await assert.rejects(command({op:'workflow_return',workflow_id:w,to_step:'acts',note:'Назад'}),/назад не возвращается/);
 await as(users.director);await assert.rejects(advance(w),/ПТО|Нет доступа/,'руководитель не двигает комплекты');
 await as(users.outsider);await assert.rejects(advance(w),/Нет доступа/,'инженер не двигает комплекты чужого объекта');
 await as(users.engineer);await advance(w,{date:'2026-10-07'});assert.equal(await stepOf(w),'signed');
 const list=(await db.query('select step_dates,step_label from pto_workflow_list where id=$1',[w])).rows[0];
 assert.deepEqual([list.step_dates.acts,list.step_dates.tn,list.step_dates.check,list.step_label],['2026-10-03','2026-10-06','2026-10-07','Проверено']);
 // Отмена ошибочного перехода: нажавший или начальник ПТО, с причиной.
 await assert.rejects(command({op:'workflow_undo',workflow_id:w,note:''}),/почему отменяете/);
 await command({op:'workflow_undo',workflow_id:w,note:'Нажал по ошибке'});assert.equal(await stepOf(w),'check');
 assert.equal((await db.query('select step_dates from pto_workflow_list where id=$1',[w])).rows[0].step_dates.check,undefined,'дата отменённого перехода не показывается');
 await assert.rejects(command({op:'workflow_undo',workflow_id:w,note:'Ещё раз'}),/Отменять нечего/);
 await advance(w,{date:'2026-10-07'});
 await assert.rejects(advance(w),/скан к каждому/);
 await attachFile(doc);await attachFile(summary);
 await assert.rejects(advance(w,{person:''}),/кому передан/);
 await advance(w,{person:'Ковалёва Т.'});assert.equal(await stepOf(w),'accepted');
 assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),100,'передача в бухгалтерию фиксирует сумму');
 assert.deepEqual((await db.query('select is_accepted from pto_document_list where workflow_id=$1',[w])).rows.map(r=>r.is_accepted),[true,true]);
 await assert.rejects(advance(w),/завершён/);
 await assert.rejects(command({op:'workflow_note',workflow_id:w,source:'ПТО',note:'Поздно'}),/передан в бухгалтерию/);
 const kinds=(await db.query('select kind from pto_workflow_events where workflow_id=$1 order by id',[w])).rows.map(r=>r.kind);
 assert.deepEqual([kinds[0],kinds.filter(k=>k==='note').length,kinds.filter(k=>k==='undo').length],['created',2,1]);
});
test('a transferred kit changes only after undo; a new version after sending is a remark and requires a fresh C-3a',async()=>{
 await as(users.second);await assert.rejects(command({op:'workflow_undo',workflow_id:(await docRow(doc)).workflow_id,note:'Чужой переход'}),/Нет доступа/);
 await as(users.head);
 await assert.rejects(run('revise',{document_id:doc,amount:'120.50',note:'Уточнение объёма',reason:'Исправление'}),/отмените переход/);
 const w=await unlock(doc);assert.equal(await stepOf(w),'signed');
 assert.equal(Number((await db.query('select count(*) from pto_register')).rows[0].count),1);
 await run('revise',{document_id:doc,amount:'120.50',note:'Уточнение объёма',reason:'Исправление'});
 assert.equal(await stepOf(w),'signed','комплект назад не возвращается');
 const notes=await openNotes(w);assert.equal(notes[0].note,'Комплект изменён после отправки заказчику: Новая версия документа № 1: Исправление');
 assert.equal((await db.query('select * from pto_versions where document_id=$1',[doc])).rows.length,2);
 await assert.rejects(db.query('update pto_versions set amount=1'),/permission denied/);
 await command({op:'workflow_note_off',workflow_id:w,event_id:notes[0].id});
 await attachFile(doc);
 await assert.rejects(advance(w),/Обновите С-3а/);
 await run('revise',{document_id:summary,reason:'По новой версии акта'});
 await pass(doc);assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),120.5);
});
test('required package blocks review; review needs accepted kits; close and reopen retain snapshots',async()=>{
 await assert.rejects(run('review'),/обязательный комплект/);
 materials=await create('c29','1','5');
 assert.equal((await db.query('select v.amount from pto_versions v join pto_documents d on d.current_version=v.id where d.id=$1',[materials])).rows[0].amount,'0.00','С-29 без суммы');
 assert.equal((await db.query('select template_code from pto_workflow_list where id=$1',[(await docRow(materials)).workflow_id])).rows[0].template_code,'c29');
 await assert.rejects(run('review'),/не принятые бухгалтерией/);
 await pass(materials);
 assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),120.5);
 await run('review');await run('close');
 await assert.rejects(run('revise',{document_id:doc,amount:'5',reason:'Проверка'}),/Период закрыт/);
 await assert.rejects(advance((await docRow(doc)).workflow_id),/Период закрыт/);
 assert.equal((await db.query('select * from pto_snapshots')).rows.length,1);
 assert.equal((await db.query('select data from pto_snapshots')).rows[0].data.workflows.length,2);
 await as(users.engineer);await assert.rejects(run('reopen',{reason:'Уточнение по письму'}),/начальнику ПТО/);
 await as(users.director);await assert.rejects(run('reopen',{reason:'Уточнение по письму'}),/Нет доступа/);
 await as(users.head);await assert.rejects(run('reopen',{reason:''}),/причину/);await run('reopen',{reason:'Уточнение по письму заказчика'});
 assert.equal((await db.query('select * from pto_snapshots')).rows.length,1);
 await as(users.head);await unlock(doc);await run('revise',{document_id:doc,amount:'130',reason:'Уточнение'});
 await assert.rejects(run('review'),/не принятые бухгалтерией/);
 await run('revise',{document_id:summary,reason:'По новой версии акта'});await pass(doc);
 await assert.rejects(run('review'),/Обновите справку и С-29/);
});
test('engineers read the whole organization but write only on assigned objects; inactive and anonymous users read nothing',async()=>{
 await as(users.head);const docs=(await db.query('select count(*)::int n from pto_documents')).rows[0].n,files=(await db.query('select count(*)::int n from storage.objects')).rows[0].n;
 assert.ok(files>0);
 for(const who of [users.outsider,users.director]){
  await as(who);
  assert.equal((await db.query('select count(*)::int n from pto_documents')).rows[0].n,docs);
  assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,files);
  assert.ok((await db.query('select * from pto_workflow_list')).rows.length>0,'конвейер организации виден');
  assert.ok((await db.query('select * from pto_profiles')).rows.length>1,'имена сотрудников видны в конвейере и журнале');
  await assert.rejects(command({op:'create_project',name:'Чужой'}),/Недостаточно прав/);
  await assert.rejects(run('revise',{document_id:doc,amount:'1',reason:'Чужой объект'}),/Нет доступа/);
  await assert.rejects(run('create_document',{contract_id:contract,kind:'c2a',number:'Ч-1',amount:'1'}),/Нет доступа/);
  await assert.rejects(command({op:'member',project_id:project,user_id:who}),/начальник ПТО/);
  await assert.rejects(command({op:'profile',user_id:users.engineer,role:'head',active:'true',display_name:'Захват'}),/начальник ПТО/);
  const r=await docRow(doc);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('pto-documents',$1)",[`${r.project_id}/${doc}/${r.current_version}/${randomUUID()}.pdf`]),/row-level security/);
 }
 await as(users.director);
 await assert.rejects(command({op:'open_period',project_id:project,month:'2026-11-01'}),/Нет доступа/);
 await assert.rejects(command({op:'create_counterparty',unp:'190000000',short_name:'Р',full_name:'Р'}),/Недостаточно прав/);
 await assert.rejects(command({op:'set_estimate',period_id:period,contract_id:contract,amount:'1.00'}),/Недостаточно прав|Нет доступа/);
 await as(users.inactive);
 assert.equal((await db.query('select * from pto_documents')).rows.length,0);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 assert.equal((await db.query('select * from pto_projects')).rows.length,0);
 await assert.rejects(command({op:'create_project',name:'Неактивный'}),/не активирована/);
 await db.exec('reset role; set role anon');await assert.rejects(db.query('select * from pto_documents'),/permission denied/);
 await assert.rejects(db.query('select pto_command($1,$2)',[randomUUID(),'{}']),/permission denied/);
});
test('subcontract prices, allocation limits, NaN, and stale source version guards',async()=>{
 await as(users.head);
 await command({op:'create_contract',project_id:project,number:'СУБ-1',party:'Субподрядчик',direction:'incoming'});
 const incomingContract=(await db.query("select id from pto_contracts where direction='incoming'")).rows[0].id;
 const incoming=(await run('create_document',{contract_id:incomingContract,kind:'c2a',number:'С1',amount:'40'})).document_id;
 assert.equal((await db.query('select template_code from pto_workflow_list where id=$1',[(await docRow(incoming)).workflow_id])).rows[0].template_code,'sub_claim');
 await pass(incoming);
 await assert.rejects(run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'NaN',note:'Проверка'}));
 // «На заказчика» больше выполнения допустимо. Субподряд в реестре — акты субподрядчика в их ценах (D), а не сопоставление.
 await run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'200',note:'Проверка'});
 let neg=(await db.query('select * from pto_register')).rows[0];assert.equal(Number(neg.subcontract),40);
 await run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'50',note:'Стоимость сопоставленных работ на заказчика'});
 let r=(await db.query('select * from pto_register')).rows[0];assert.equal(Number(r.total),130);assert.equal(Number(r.subcontract),40);
 await unlock(materials);await run('revise',{document_id:materials,reason:'Обновлены основания'});await pass(materials);
 await run('review');await run('close');
 await run('reopen',{reason:'Уточнение субподрядчика'});
 await as(users.head);await unlock(incoming);await run('revise',{document_id:incoming,amount:'45',reason:'Корректировка'});await pass(incoming);
 await assert.rejects(run('review'),/распределение субподряда/);
 const before=(await db.query('select data from pto_snapshots order by created_at desc limit 1')).rows[0].data;
 assert.equal(Number(before.register[0].total),130);assert.equal(Number(before.register[0].subcontract),40);
});
test('all public tables have RLS, definer functions are private, and anonymous execute is denied',async()=>{
 await db.exec('reset role');
 const unsafe=await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");assert.equal(unsafe.rows.length,0);
 const exposed=await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and prosecdef");assert.equal(exposed.rows.length,0);
 const granted=await db.query("select has_function_privilege('anon','public.pto_command(uuid,jsonb)','execute') allowed");assert.equal(granted.rows[0].allowed,false);
});
test('clients cannot write tables directly; new tables get no client grants',async()=>{
 await db.exec('reset role');
 const writable=await db.query(`select c.relname,r.role from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values('anon'),('authenticated')) r(role)
  where n.nspname='public' and c.relkind in ('r','v') and (has_table_privilege(r.role,c.oid,'insert') or has_table_privilege(r.role,c.oid,'update') or has_table_privilege(r.role,c.oid,'delete') or has_table_privilege(r.role,c.oid,'truncate'))`);
 assert.deepEqual(writable.rows,[]);
 const anonRead=await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v') and has_table_privilege('anon',c.oid,'select')");
 assert.deepEqual(anonRead.rows,[]);
 await db.exec('create table public.tmp_default_grants(id int)');
 const fresh=await db.query("select has_table_privilege('anon','public.tmp_default_grants','select') a,has_table_privilege('authenticated','public.tmp_default_grants','insert') b");
 assert.deepEqual(fresh.rows[0],{a:false,b:false});await db.exec('drop table public.tmp_default_grants');
 await as(users.head);await assert.rejects(db.query('insert into pto_contract_addenda(contract_id,number,agreement_date) values($1,$2,$3)',[contract,'ДС-1','2026-10-01']),/permission denied/);
});
test('register matrix: exact August figures, column per sub-contract, hidden empties, object subtotals, RLS',async()=>{
 await as(users.head);const month='2026-08-01';
 const revOf=async per=>(await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision;
 const op=async(per,name,extra)=>command({op:name,period_id:per,expected_revision:await revOf(per),...extra});
 async function object(name){const pid=(await command({op:'create_project',name})).project_id;return {pid,per:(await command({op:'open_period',project_id:pid,month})).period_id};}
 async function contract(pid,number,party,direction){await command({op:'create_contract',project_id:pid,number,party,direction});return (await db.query('select id from pto_contracts where project_id=$1 and number=$2',[pid,number])).rows[0].id;}
 // Принятый акт: исходящий — комплектом с С-3а, входящий — комплектом субподрядчика.
 async function act({pid,per},contractId,number,amount,accepted=true){
  const d=(await op(per,'create_document',{contract_id:contractId,kind:'c2a',number,amount})).document_id;if(!accepted)return d;
  if((await db.query('select direction from pto_contracts where id=$1',[contractId])).rows[0].direction==='outgoing')
   await op(per,'create_document',{contract_id:contractId,kind:'c3a',number:'С-3а '+number});
  await pass(d);return d;
 }
 const allocate=(o,out,inc,amount)=>op(o.per,'allocate',{outgoing_document:out,incoming_document:inc,amount,note:'Работы на заказчика'});
 // Пружаны, дог. №21 (бриф, раздел 7) и ещё два договора объекта.
 const pr=await object('Пружаны');
 const d21=await act(pr,await contract(pr.pid,'21','Заказчик','outgoing'),'1','1973259.89');
 await act(pr,await contract(pr.pid,'21-В','Заказчик','outgoing'),'2','100.00');
 await act(pr,await contract(pr.pid,'21-Г','Заказчик','outgoing'),'3','500.00',false);
 const m1=await act(pr,await contract(pr.pid,'М-1','Мегалит','incoming'),'с1','400000.00');
 const m2=await act(pr,await contract(pr.pid,'М-2','Мегалит','incoming'),'с2','69709.47');
 await act(pr,await contract(pr.pid,'Н-1','Нулевой','incoming'),'с3','10.00');
 await allocate(pr,d21,m1,'400000.00');await allocate(pr,d21,m2,'69709.47');
 // Паркинг, дог. №265: собственные силы отрицательны.
 const pk=await object('Паркинг');
 const d265=await act(pk,await contract(pk.pid,'265','Заказчик','outgoing'),'1','100000.00');
 const p1=await act(pk,await contract(pk.pid,'П-1','Субподрядчик П','incoming'),'с1','324583.85');
 await allocate(pk,d265,p1,'324583.85');
 const m=(await db.query('select public.pto_register_matrix($1) m',[month])).rows[0].m;
 const contractRow=number=>m.rows.find(r=>r.kind==='contract'&&r.number===number);
 assert.deepEqual([contractRow('21').total,contractRow('21').own,contractRow('21').subcontract],['1973259.89','1503550.42','469709.47']);
 assert.equal(contractRow('265').own,'-224583.85');
 assert.equal(contractRow('21-Г'),undefined,'договор без принятых сумм скрыт');
 assert.deepEqual(m.columns.map(c=>c.label),['Мегалит · №М-1','Мегалит · №М-2','Субподрядчик П']);
 const col=label=>m.columns.find(c=>c.label===label).id;
 assert.equal(contractRow('21').cells[col('Мегалит · №М-2')],'69709.47');
 const subtotals=m.rows.filter(r=>r.kind==='project');
 assert.deepEqual(subtotals.map(r=>[r.project,r.total,r.own]),[['Пружаны','1973359.89','1503650.42']]);
 assert.deepEqual([m.total.total,m.total.own,m.total.subcontract],['2073359.89','1279066.57','794293.32']);
 assert.equal(m.total.cells[col('Субподрядчик П')],'324583.85');
 await as(users.director);assert.equal((await db.query('select public.pto_register_matrix($1) m',[month])).rows[0].m.total.total,m.total.total,'руководитель видит реестр организации');
 await as(users.inactive);assert.deepEqual((await db.query('select public.pto_register_matrix($1) m',[month])).rows[0].m.rows,[]);
 await db.exec('reset role; set role anon');await assert.rejects(db.query('select public.pto_register_matrix($1)',[month]),/permission denied/);
});
test('contracts: direction and counterparty name are derived, current price and term follow signed addenda',async()=>{
 await as(users.head);
 const pid=(await command({op:'create_project',name:'Договоры'})).project_id;
 await command({op:'member',project_id:pid,user_id:users.engineer});
 const cp=(await command({op:'create_counterparty',unp:'191426884',short_name:'Трест',full_name:'Трест полностью',roles:['general_contractor']})).counterparty_id;
 await command({op:'create_contract',project_id:pid,number:'21',counterparty_id:cp,our_role:'subcontractor',counterparty_role:'general_contractor'});
 const contract=async number=>(await db.query('select * from pto_contract_list where project_id=$1 and number=$2',[pid,number])).rows[0];
 let c=await contract('21');
 assert.equal(c.direction,'outgoing');assert.equal(c.party,'Трест');
 assert.equal((await db.query('select party_text from pto_contracts where id=$1',[c.id])).rows[0].party_text,null,'имя контрагента не копируется');
 await command({op:'update_counterparty',counterparty_id:cp,unp:'191426884',short_name:'Трест №1',full_name:'Трест полностью'});
 assert.equal((await contract('21')).party,'Трест №1');
 await db.exec('reset role');await assert.rejects(db.query("update pto_contracts set direction='incoming'"),/generated|direction/);await as(users.head);
 // Условия вводятся командой; суммы — рубли и копейки.
 await as(users.engineer);
 const terms={op:'update_contract',contract_id:c.id,number:'21',contract_date:'2026-02-12',subject:'СМР',initial_amount:'1000.00',vat_rate:'20',vat_amount:'166.67',work_start_date:'2026-03-01',work_end_date:'2026-12-31'};
 await command(terms);
 await assert.rejects(command({...terms,initial_amount:'10.001'}),/рублях и копейках/);
 await assert.rejects(command({...terms,initial_amount:'-1'}),/Некорректная сумма/);
 c=await contract('21');assert.equal(c.current_amount,'1000.00');assert.equal(String(c.current_end_date.toISOString?.().slice(0,10)??c.current_end_date),'2026-12-31');
 // Проект ДС не учитывается; подписанные ДС меняют цену и срок независимо; отменённый ДС перестаёт действовать.
 const ds1=(await command({op:'create_addendum',contract_id:c.id,number:'1',agreement_date:'2026-05-15',amount_after:'1200.00',vat_amount:'200.00'})).addendum_id;
 assert.equal((await contract('21')).current_amount,'1000.00');
 await command({op:'set_addendum_status',addendum_id:ds1,status:'signed'});
 await command({op:'create_addendum',contract_id:c.id,number:'2',agreement_date:'2026-06-01',work_end_date:'2027-03-31',status:'signed'});
 c=await contract('21');
 assert.deepEqual([c.current_amount,c.current_vat_amount,c.amount_addendum_number,c.term_addendum_number,c.signed_addenda],['1200.00','200.00','1','2',2]);
 await assert.rejects(command({op:'set_addendum_status',addendum_id:ds1,status:'cancelled',reason:''}),/причину/);
 await command({op:'set_addendum_status',addendum_id:ds1,status:'cancelled',reason:'Заменено ДС №3'});
 assert.equal((await contract('21')).current_amount,'1000.00');
 await assert.rejects(command({op:'set_addendum_status',addendum_id:ds1,status:'signed'}),/Недопустимый переход/);
 // Права и журнал.
 await as(users.outsider);await assert.rejects(command({...terms}),/Нет доступа/);
 await as(users.director);await assert.rejects(command({...terms}),/Недостаточно прав/);
 await as(users.head);
 const actions=(await db.query("select action from pto_events where action in ('update_contract','create_addendum','set_addendum_status','create_counterparty','update_counterparty')")).rows.map(r=>r.action);
 for(const a of ['update_contract','create_addendum','set_addendum_status','create_counterparty','update_counterparty'])assert.ok(actions.includes(a),a);
 await as(users.engineer);await assert.rejects(db.query('insert into pto_contract_addenda(contract_id,number,agreement_date) values($1,$2,$3)',[c.id,'9','2026-01-01']),/permission denied/);
});
test('C-3a: SMR comes from the kit acts, to-pay and cumulative columns are computed; C-29 has no sum; estimates kept apart',async()=>{
 await as(users.head);
 const revOf=async per=>(await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision;
 const op=async(per,name,extra)=>command({op:name,period_id:per,expected_revision:await revOf(per),...extra});
 const pid=(await command({op:'create_project',name:'С-3а'})).project_id;
 await command({op:'create_contract',project_id:pid,number:'21',party:'Трест',direction:'outgoing'});
 await command({op:'create_contract',project_id:pid,number:'22',party:'Трест',direction:'outgoing'});
 await command({op:'create_contract',project_id:pid,number:'С-1',party:'Субподрядчик',direction:'incoming'});
 const cid=async n=>(await db.query('select id from pto_contracts where project_id=$1 and number=$2',[pid,n])).rows[0].id;
 const c21=await cid('21');
 // Субподрядчик в июле и августе не подавал: ожидание снято с причиной, наша процентовка уходит заказчику без него.
 for(const month of ['2026-07-01','2026-08-01'])await command({op:'workflow_skip',project_id:pid,contract_id:await cid('С-1'),template_code:'sub_claim',month,reason:'работ не было'});
 const doc=async(per,kind,number,extra)=>(await op(per,'create_document',{contract_id:c21,kind,number,...extra})).document_id;
 const report=async d=>(await db.query('select r.* from pto_c3a_report r join pto_documents d on d.current_version=r.version_id where d.id=$1',[d])).rows[0];
 // Июль: предыдущий месяц для накопления.
 const jul=(await command({op:'open_period',project_id:pid,month:'2026-07-01'})).period_id;
 await doc(jul,'c2a','7',{amount:'1000.00'});
 await pass(await doc(jul,'c3a','7',{smr_vat:'166.67'}));
 // Август: цифры приёмки из брифа (раздел 7).
 const aug=(await command({op:'open_period',project_id:pid,month:'2026-08-01'})).period_id;
 await doc(aug,'c2a','8',{amount:'1973259.89'});
 const c3a=await doc(aug,'c3a','8',{amount:'5',smr_vat:'328876.65',equipment_amount:'731538.30',equipment_vat:'121923.05',advance_target_offset:'1000000.00',advance_current_offset:'153974.13'});
 let r=await report(c3a);
 assert.equal(r.smr,'1973259.89','СМР с НДС берётся из актов комплекта, введённая сумма игнорируется');
 assert.equal(r.to_pay,'1550824.06','к оплате = 1 973 259,89 + 731 538,30 − 1 153 974,13');
 assert.deepEqual([r.ytd_smr,r.total_smr,r.ytd_smr_vat,r.total_to_pay],['1974259.89','1974259.89','329043.32','1551824.06']);
 // В августе есть и другие объекты (тест «Пружаны»): строки берутся только этого объекта.
 const aug8=async()=>(await db.query("select pto_register_matrix('2026-08-01') m")).rows[0].m.rows.filter(x=>x.project_id===pid);
 const line=(rows,n)=>rows.find(x=>x.kind==='contract'&&x.number===n);
 let rows=await aug8();
 assert.equal(line(rows,'21'),undefined,'до подписания заказчиком в реестре нет суммы');
 // Новая версия без переданных полей сохраняет прежние значения, кроме изменённого.
 await op(aug,'revise',{document_id:c3a,advance_current_offset:'153974.14',reason:'Исправление зачёта'});
 r=await report(c3a);assert.deepEqual([r.equipment,r.current_offset,r.to_pay],['731538.30','153974.14','1550824.05']);
 await assert.rejects(op(aug,'revise',{document_id:c3a,smr_vat:'1.001',reason:'Проверка'}),/рублях и копейках/);
 // Подписано заказчиком, но не принято бухгалтерией — сумма по актам с пометкой; после принятия — по С-3а.
 await pass(c3a,'signed');
 rows=await aug8();assert.deepEqual([line(rows,'21').basis,line(rows,'21').total],['signed','1973259.89']);
 await pass(c3a);
 rows=await aug8();
 assert.equal(line(rows,'21').basis,'c3a');assert.equal(line(rows,'21').total,'1973259.89');
 // С-29 без суммы.
 const c29=await doc(aug,'c29','8',{amount:'999'});
 assert.equal((await db.query('select v.amount from pto_documents d join pto_versions v on v.id=d.current_version where d.id=$1',[c29])).rows[0].amount,'0.00');
 // Оценка: отдельно от принятого, последняя действует, история не изменяется.
 await command({op:'set_estimate',period_id:aug,contract_id:c21,amount:'2000000.00'});
 await command({op:'set_estimate',period_id:aug,contract_id:c21,amount:'2100000.00',note:'Уточнено прорабом'});
 await command({op:'set_estimate',period_id:aug,contract_id:await cid('22'),amount:'500.00'});
 await assert.rejects(command({op:'set_estimate',period_id:aug,contract_id:await cid('С-1'),amount:'1.00'}),/договору с заказчиком/);
 rows=await aug8();
 const row21=line(rows,'21'),row22=line(rows,'22'),subtotal=rows.find(x=>x.kind==='project');
 assert.deepEqual([row21.estimate,row21.total],['2100000.00','1973259.89']);
 assert.deepEqual([row22.estimate,row22.total,row22.basis],['500.00','0.00',null],'договор только с оценкой виден в реестре');
 assert.deepEqual([subtotal.total,subtotal.estimate],['1973259.89','2100500.00'],'оценка не входит во «Всего»');
 assert.equal((await db.query('select count(*)::int n from pto_estimates where contract_id=$1',[c21])).rows[0].n,2);
 await as(users.outsider);await assert.rejects(command({op:'set_estimate',period_id:aug,contract_id:c21,amount:'1.00'}),/Нет доступа/);
 await db.exec('reset role');await assert.rejects(db.query('update pto_estimates set amount=0'),/только на добавление/);
});
test('roles: head is the administrator, director is read-only; the theme is kept in the profile and only by its owner',async()=>{
 await as(users.head);
 await assert.rejects(command({op:'profile',user_id:users.second,role:'accountant',active:'true',display_name:'Бухгалтер'}),/pto_profiles_role_check/);
 await assert.rejects(command({op:'profile',user_id:users.second,role:'admin',active:'true',display_name:'Администратор'}),/pto_profiles_role_check/);
 await assert.rejects(command({op:'profile',user_id:users.head,role:'engineer',active:'true',display_name:'Сам'}),/Свою роль/);
 await as(users.director);await command({op:'set_theme',theme:'light'});
 await as(users.head);
 await command({op:'profile',user_id:users.second,role:'head',active:'true',display_name:'Второй'});
 await as(users.engineer);
 await command({op:'set_theme',theme:'dark'});
 await assert.rejects(command({op:'set_theme',theme:'neon'}),/тема/);
 assert.equal((await db.query('select theme from pto_profiles where id=$1',[users.engineer])).rows[0].theme,'dark');
 await assert.rejects(db.query("update pto_profiles set theme='light' where id=$1",[users.engineer]),/permission denied/);
 await as(users.head);assert.equal((await db.query('select theme from pto_profiles where id=$1',[users.head])).rows[0].theme,'system');
});
test('audit log, workflow events and snapshots are append-only even for the database owner',async()=>{
 await db.exec('reset role');
 assert.ok((await db.query('select count(*)::int n from pto_events')).rows[0].n>0);
 await assert.rejects(db.query("update pto_events set action='x'"),/только на добавление/);
 await assert.rejects(db.query('delete from pto_events'),/только на добавление/);
 await assert.rejects(db.query('delete from pto_snapshots'),/только на добавление/);
 await assert.rejects(db.query('truncate pto_estimates'),/только на добавление/);
 assert.ok((await db.query('select count(*)::int n from pto_workflow_events')).rows[0].n>0);
 await assert.rejects(db.query('delete from pto_workflow_events'),/только на добавление/);
 await assert.rejects(db.query("update pto_workflow_events set note=''"),/только на добавление/);
 await assert.rejects(db.query('truncate pto_workflow_events'),/только на добавление/);
 const cascades=await db.query("select conrelid::regclass::text tbl,conname from pg_constraint where contype='f' and connamespace='public'::regnamespace and confdeltype='c'");
 assert.deepEqual(cascades.rows,[]);
 // Прежний конвейер удалён (шаг 6б): маршруты — единственный механизм состояний.
 assert.deepEqual((await db.query("select relname from pg_class where relname like 'pto_process%' and relkind='r'")).rows,[]);
});
test('counterparties: MNS XML import creates or updates by UNP and keeps manual fields; director reads only',async()=>{
 await as(users.engineer);
 const row={unp:'693340482',full_name:'Общество с ограниченной ответственностью "КИПМОНТАЖ"',short_name:'ООО "КИПМОНТАЖ"',address:'Минский район',registration_date:'2024-11-04',tax_office_code:'613',tax_office_name:'Инспекция МНС РБ по Минскому району',status_code:'1',status_name:'Действующий',status_change_date:'',liquidation_info:''};
 assert.deepEqual(await command({op:'import_counterparties',checked_at:'2026-10-07',rows:[row]}),{created:1,updated:0,unchanged:0});
 const cp=(await db.query("select * from pto_counterparties where unp='693340482'")).rows[0];
 assert.equal(cp.source,'МНС XML');assert.equal(cp.mns_checked_at.toISOString().slice(0,10),'2026-10-07');
 // Карточка отправляет официальные поля скрытыми, как есть.
 await command({op:'update_counterparty',counterparty_id:cp.id,...row,director_name:'Петров П.П.',bank_bic:'AKBBBY2X',roles:['subcontractor']});
 assert.deepEqual(await command({op:'import_counterparties',checked_at:'2026-10-08',rows:[row]}),{created:0,updated:0,unchanged:1});
 assert.deepEqual(await command({op:'import_counterparties',checked_at:'2026-11-01',rows:[{...row,status_code:'3',status_name:'Ликвидирован',status_change_date:'2026-10-30',liquidation_info:'Решение № 1'}]}),{created:0,updated:1,unchanged:0});
 const after=(await db.query("select * from pto_counterparties where unp='693340482'")).rows[0];
 assert.deepEqual([after.status_name,after.director_name,after.bank_bic],['Ликвидирован','Петров П.П.','AKBBBY2X'],'импорт не трогает ручные поля');
 assert.deepEqual((await db.query('select role from pto_counterparty_roles where counterparty_id=$1',[cp.id])).rows.map(r=>r.role),['subcontractor']);
 assert.equal((await db.query("select count(*)::int n from pto_events where action='import_counterparty'")).rows[0].n,2,'журнал: создание и изменение, без «без изменений»');
 await assert.rejects(command({op:'import_counterparties',rows:[{...row,unp:'12'}]}),/9 цифр/);
 await assert.rejects(command({op:'import_counterparties',rows:[]}),/Нет строк/);
 await as(users.director);
 assert.equal((await db.query("select * from pto_counterparties where unp='693340482'")).rows.length,1);
 await assert.rejects(command({op:'import_counterparties',rows:[row]}),/Недостаточно прав/);
});
test('counterparties: postal code for contract requisites, contact persons with objects; director reads only',async()=>{
 await as(users.engineer);
 const cp=(await db.query("select * from pto_counterparties where unp='693340482'")).rows[0];
 const {unp,short_name,full_name,address,status_name}=cp;
 await command({op:'update_counterparty',counterparty_id:cp.id,unp,short_name,full_name,address,status_name,postal_code:'223053'});
 assert.equal((await db.query('select postal_code from pto_counterparties where id=$1',[cp.id])).rows[0].postal_code,'223053');
 await assert.rejects(command({op:'update_counterparty',counterparty_id:cp.id,unp,short_name,full_name,postal_code:'2230'}),/индекс/);
 const project=(await db.query('select id from pto_projects limit 1')).rows[0].id;
 const {contact_id}=await command({op:'save_counterparty_contact',counterparty_id:cp.id,name:'Сидоренко Ольга',position:'Инженер ПТО',topics:'Процентовки',project_ids:[project],phone:'+375 29 555-12-34',email:'o@x.by'});
 await command({op:'save_counterparty_contact',contact_id,name:'Сидоренко Ольга Ивановна',topics:'Процентовки',project_ids:[]});
 let row=(await db.query('select * from pto_counterparty_contacts where id=$1',[contact_id])).rows[0];
 assert.deepEqual([row.name,row.project_ids,row.counterparty_id],['Сидоренко Ольга Ивановна',[],cp.id]);
 await assert.rejects(command({op:'save_counterparty_contact',counterparty_id:cp.id,name:' '}),/ФИО/);
 await assert.rejects(command({op:'save_counterparty_contact',counterparty_id:cp.id,name:'X',project_ids:[randomUUID()]}),/Объект не найден/);
 await as(users.director);
 assert.equal((await db.query('select * from pto_counterparty_contacts')).rows.length,1);
 await assert.rejects(command({op:'delete_counterparty_contact',contact_id}),/Недостаточно прав/);
 await as(users.engineer);
 await command({op:'delete_counterparty_contact',contact_id});
 assert.equal((await db.query('select * from pto_counterparty_contacts')).rows.length,0);
 assert.equal((await db.query("select count(*)::int n from pto_events where action in ('save_counterparty_contact','delete_counterparty_contact')")).rows[0].n,3);
 await as(users.inactive);assert.equal((await db.query('select * from pto_counterparties')).rows.length,0);
});
test('text size is kept in the profile, only by its owner and only from the allowed values',async()=>{
 await as(users.engineer);
 assert.equal((await db.query('select text_scale from pto_profiles where id=$1',[users.engineer])).rows[0].text_scale,100);
 const req=randomUUID();assert.deepEqual(await command({op:'set_text_scale',text_scale:130},req),{text_scale:130});
 assert.deepEqual(await command({op:'set_text_scale',text_scale:130},req),{text_scale:130},'повтор запроса не меняет результат');
 await assert.rejects(command({op:'set_text_scale',text_scale:200}),/размер текста/);
 await assert.rejects(command({op:'set_text_scale'}),/размер текста/);
 await assert.rejects(db.query('update pto_profiles set text_scale=115 where id=$1',[users.engineer]),/permission denied/);
 await as(users.director);await command({op:'set_text_scale',text_scale:115});
 await as(users.head);
 assert.equal((await db.query('select text_scale from pto_profiles where id=$1',[users.engineer])).rows[0].text_scale,130);
 assert.equal((await db.query('select text_scale from pto_profiles where id=$1',[users.director])).rows[0].text_scale,115);
 assert.equal((await db.query('select text_scale from pto_profiles where id=$1',[users.head])).rows[0].text_scale,100);
 assert.deepEqual(await command({op:'set_theme',theme:'light'}),{theme:'light'},'тема сохраняется прежней командой');
});
test('signing board: expected card starts with a date or is skipped with a reason; our claim waits for subcontractors at the supervisor',async()=>{
 await as(users.head);
 const pid=(await command({op:'create_project',name:'Подписание'})).project_id,month='2026-09-01';
 await command({op:'member',project_id:pid,user_id:users.engineer});
 await command({op:'create_contract',project_id:pid,number:'П-1',party:'Заказчик П',direction:'outgoing'});
 await command({op:'create_contract',project_id:pid,number:'ПС-1',party:'Мегалит',direction:'incoming'});
 await command({op:'create_contract',project_id:pid,number:'ПС-2',party:'Стройком',direction:'incoming'});
 const cid=async n=>(await db.query('select id from pto_contracts where project_id=$1 and number=$2',[pid,n])).rows[0].id;
 const [our,mega,stroy]=[await cid('П-1'),await cid('ПС-1'),await cid('ПС-2')];
 await as(users.engineer);
 await assert.rejects(command({op:'workflow_start',project_id:pid,contract_id:our,template_code:'sub_claim',month,date:'2026-10-02'}),/не подходит/);
 // «Объёмы сданы»: комплект появляется на «Готовятся акты» с датой сдачи.
 const w=(await command({op:'workflow_start',project_id:pid,contract_id:our,template_code:'claim',month,date:'2026-10-02'})).workflow_id;
 assert.equal(await stepOf(w),'acts');
 assert.equal((await db.query('select step_dates from pto_workflow_list where id=$1',[w])).rows[0].step_dates.wait,'2026-10-02');
 await assert.rejects(command({op:'workflow_start',project_id:pid,contract_id:our,template_code:'claim',month}),/уже есть/);
 const per=(await db.query('select id from pto_periods where project_id=$1 and month=$2',[pid,month])).rows[0].id;
 const op=async(name,extra)=>command({op:name,period_id:per,expected_revision:await periodRev(per),...extra});
 const act=(await op('create_document',{contract_id:our,kind:'c2a',number:'9',amount:'1000'})).document_id;
 assert.equal((await docRow(act)).workflow_id,w,'акт попадает в начатый комплект');
 await op('create_document',{contract_id:our,kind:'c3a',number:'9'});
 await advance(w);assert.equal(await stepOf(w),'tn');
 // Мегалит подал технадзору и прошёл его, Стройком не подаёт: наша процентовка не уходит заказчику.
 const sw=(await command({op:'workflow_start',project_id:pid,contract_id:mega,template_code:'sub_claim',month,date:'2026-10-03'})).workflow_id;
 assert.equal(await stepOf(sw),'tn');
 await assert.rejects(advance(w),/Мегалит, Стройком/);
 await advance(sw,{date:'2026-10-05'});assert.equal(await stepOf(sw),'check');
 await assert.rejects(advance(w),/субподрядчиков: Стройком/);
 await assert.rejects(command({op:'workflow_skip',project_id:pid,contract_id:stroy,template_code:'sub_claim',month,reason:''}),/причину/);
 await command({op:'workflow_skip',project_id:pid,contract_id:stroy,template_code:'sub_claim',month,reason:'нет ДС на новые сметы'});
 assert.equal((await db.query('select reason from pto_workflow_skips where contract_id=$1',[stroy])).rows[0].reason,'нет ДС на новые сметы');
 await assert.rejects(command({op:'workflow_start',project_id:pid,contract_id:stroy,template_code:'sub_claim',month}),/Ожидание снято/);
 await advance(w);assert.equal(await stepOf(w),'check','все субподрядчики прошли технадзор или исключены');
 // Ошибочное исключение возвращается; переход нашей процентовки отменяет только нажавший или начальник ПТО.
 await command({op:'workflow_unskip',project_id:pid,contract_id:stroy,template_code:'sub_claim',month});
 await as(users.outsider);await assert.rejects(command({op:'workflow_undo',workflow_id:w,note:'Не я нажимал'}),/Нет доступа/);
 await as(users.head);await command({op:'workflow_undo',workflow_id:w,note:'Стройком всё-таки подаёт'});assert.equal(await stepOf(w),'tn');
 // Субподрядчик на проверке у ПТО: сначала «Комплект получен», потом «Проверено».
 await as(users.engineer);
 const sub=(await op('create_document',{contract_id:mega,kind:'c2a',number:'М1',amount:'300'})).document_id;
 assert.equal((await docRow(sub)).workflow_id,sw);
 await assert.rejects(advance(sw),/Комплект получен/);
 await assert.rejects(command({op:'workflow_received',workflow_id:w}),/на проверке у ПТО/);
 await command({op:'workflow_received',workflow_id:sw,date:'2026-10-06'});
 assert.equal((await db.query('select received_on from pto_workflow_list where id=$1',[sw])).rows[0].received_on.toISOString().slice(0,10),'2026-10-06');
 await advance(sw);assert.equal(await stepOf(sw),'signed');
 await attachFile(sub);await assert.rejects(advance(sw,{proof:''}),/бумага подписана/);
 await advance(sw);assert.equal(await stepOf(sw),'accepted');
 await as(users.director);await assert.rejects(command({op:'workflow_skip',project_id:pid,contract_id:stroy,template_code:'sub_claim',month,reason:'работ не было'}),/ПТО/);
 assert.ok((await db.query('select * from pto_workflow_skips')).rows.length>0,'руководитель видит снятые ожидания');
});

test('month marks: subcontractor in the month, object marks, document marks and scan checks are append-only, latest wins',async()=>{
 await as(users.head);
 const pid=(await command({op:'create_project',name:'Месяц'})).project_id;
 await command({op:'member',project_id:pid,user_id:users.engineer});
 const per=(await command({op:'open_period',project_id:pid,month:'2026-09-01'})).period_id;
 await command({op:'create_contract',project_id:pid,number:'21',party:'Трест',direction:'outgoing'});
 await command({op:'create_contract',project_id:pid,number:'21-06',party:'ТАГКров',direction:'incoming'});
 const cid=async n=>(await db.query('select id from pto_contracts where project_id=$1 and number=$2',[pid,n])).rows[0].id;
 const [our,tag]=[await cid('21'),await cid('21-06')];
 await as(users.engineer);
 await assert.rejects(command({op:'set_sub_month',period_id:per,contract_id:our,plan:'1'}),/договор субподряда/);
 await command({op:'set_sub_month',period_id:per,contract_id:tag,plan:'100 000,00'});
 const revBefore=(await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision;
 await command({op:'set_sub_month',period_id:per,contract_id:tag,tn_status:'oral',on_customer:'113607.11'});
 let cur=(await db.query('select * from pto_sub_month_current where contract_id=$1',[tag])).rows[0];
 assert.deepEqual([cur.expected,cur.plan,cur.tn_status,cur.on_customer],[true,'100000.00','oral','113607.11'],'непереданные поля остаются');
 assert.equal((await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision,revBefore+1,'сумма «на заказчика» возвращает месяц на проверку');
 await command({op:'set_sub_month',period_id:per,contract_id:tag,tn_status:'ok',target_offset:'10000',current_offset:null});
 cur=(await db.query('select * from pto_sub_month_current where contract_id=$1',[tag])).rows[0];
 assert.deepEqual([cur.tn_status,cur.target_offset,cur.current_offset],['ok','10000.00',null]);
 assert.equal((await db.query('select count(*)::int n from pto_sub_month where contract_id=$1',[tag])).rows[0].n,3,'журнал: все записи сохраняются');
 await assert.rejects(command({op:'set_sub_month',period_id:per,contract_id:tag,tn_status:'maybe'}),/статус/);
 await command({op:'set_month_marks',period_id:per,equipment_expected:true});
 await command({op:'set_month_marks',period_id:per,materials_expected:true});
 assert.deepEqual((await db.query('select equipment_expected e,materials_expected m from pto_month_marks_current where period_id=$1',[per])).rows[0],{e:true,m:true});
 // Документ: статус ТН, замечание с текстом, место оригинала, сверка скана с хэшем.
 const d=(await command({op:'create_document',period_id:per,expected_revision:(await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision,contract_id:our,kind:'c2b',number:'27',amount:'425798.48'})).document_id;
 await assert.rejects(command({op:'set_document_mark',document_id:d,tn_status:'remarks'}),/замечание/);
 await command({op:'set_document_mark',document_id:d,tn_status:'remarks',note:'уточнить объём'});
 await command({op:'set_document_mark',document_id:d,tn_status:'ok',part:'Цех — пристройка',original:'party',materials:'48210.36'});
 assert.deepEqual((await db.query('select tn_status,part,original,materials from pto_document_marks_current where document_id=$1',[d])).rows[0],{tn_status:'ok',part:'Цех — пристройка',original:'party',materials:'48210.36'});
 await attachFile(d);
 const f=(await db.query('select f.id from pto_files f join pto_versions v on v.id=f.version_id where v.document_id=$1',[d])).rows[0].id;
 await assert.rejects(command({op:'check_file',file_id:f,sha256:'abc',result:'ok'}),/SHA-256/);
 await assert.rejects(command({op:'check_file',file_id:f,sha256:'a'.repeat(64),result:'mismatch'}),/расхождение/);
 await command({op:'check_file',file_id:f,sha256:'a'.repeat(64),result:'ok'});
 assert.equal((await db.query('select result from pto_file_checks_current where file_id=$1',[f])).rows[0].result,'ok');
 // Только добавление, чтение по правам, руководитель не пишет, посторонний инженер не пишет.
 await db.exec('reset role');await assert.rejects(db.query('update pto_sub_month set plan=1'),/append-only|запрещ|only/i);await as(users.engineer);
 await as(users.director);assert.ok((await db.query('select * from pto_sub_month_current')).rows.length>0);
 await assert.rejects(command({op:'set_month_marks',period_id:per,equipment_expected:false}),/прав/);
 await as(users.outsider);await assert.rejects(command({op:'set_month_marks',period_id:per,equipment_expected:false}),/Нет доступа/);
 assert.equal((await db.query("select count(*)::int n from pto_events where project_id=$1 and action in ('set_sub_month','set_month_marks','set_document_mark','check_file')",[pid])).rows[0].n,8,'каждая отметка в журнале объекта; читают все инженеры организации');
});
test('register: own forces = total − subcontractors\' acts in their prices; «на заказчика» from the month mark, else from the allocation',async()=>{
 await as(users.head);const month='2026-11-01';
 const pid=(await command({op:'create_project',name:'Лида'})).project_id;
 const per=(await command({op:'open_period',project_id:pid,month})).period_id;
 const rev=async()=>(await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision;
 const op=async(name,extra)=>command({op:name,period_id:per,expected_revision:await rev(),...extra});
 const contract=async(number,party,direction)=>{await command({op:'create_contract',project_id:pid,number,party,direction});return (await db.query('select id from pto_contracts where project_id=$1 and number=$2',[pid,number])).rows[0].id;};
 const [our,s1,s2]=[await contract('Л-1','Заказчик','outgoing'),await contract('Л-С1','Каменщик','incoming'),await contract('Л-С2','Электрик','incoming')];
 const a1=(await op('create_document',{contract_id:s1,kind:'c2a',number:'к1',amount:'300.00'})).document_id;
 const a2=(await op('create_document',{contract_id:s2,kind:'c2a',number:'э1',amount:'100.00'})).document_id;
 await pass(a1);await pass(a2);
 const out=(await op('create_document',{contract_id:our,kind:'c2a',number:'1',amount:'1000.00'})).document_id;
 await op('create_document',{contract_id:our,kind:'c3a',number:'С-3а 1'});await pass(out);
 await op('allocate',{outgoing_document:out,incoming_document:a1,amount:'450.00',note:'На заказчика'});
 await op('allocate',{outgoing_document:out,incoming_document:a2,amount:'120.00',note:'На заказчика'});
 await command({op:'set_sub_month',period_id:per,contract_id:s2,on_customer:'160.00'});
 const reg=(await db.query('select * from pto_register where period_id=$1',[per])).rows[0];
 assert.deepEqual([reg.total,reg.subcontract],['1000.00','400.00'],'субподряд = Σ актов субподрядчиков, а не сопоставление 570');
 const m=(await db.query('select public.pto_register_matrix($1) m',[month])).rows[0].m;
 const row=m.rows.find(r=>r.kind==='contract'&&r.contract_id===our);
 assert.deepEqual([row.total,row.own,row.subcontract],['1000.00','600.00','400.00'],'генуслуги входят в свои силы');
 assert.deepEqual(row.cells,{[s1]:'300.00',[s2]:'100.00'});
 assert.deepEqual(row.customer_cells,{[s1]:'450.00',[s2]:'160.00'},'отметка месяца важнее сопоставления');
});
test('sent to customer with a date, re-sending needs a reason; contract parts with their own VAT give registry rows per part',async()=>{
 await as(users.head);const month='2026-12-01';
 const pid=(await command({op:'create_project',name:'Брест'})).project_id;
 const per=(await command({op:'open_period',project_id:pid,month})).period_id;
 const rev=async()=>(await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision;
 const op=async(name,extra)=>command({op:name,period_id:per,expected_revision:await rev(),...extra});
 await command({op:'create_contract',project_id:pid,number:'Б-1',party:'Заказчик',direction:'outgoing'});
 await command({op:'create_contract',project_id:pid,number:'Б-2',party:'Заказчик 2',direction:'outgoing'});
 const cid=async n=>(await db.query('select id from pto_contracts where project_id=$1 and number=$2',[pid,n])).rows[0].id;
 const [our,other]=[await cid('Б-1'),await cid('Б-2')];
 // Отправка заказчику.
 await command({op:'set_month_marks',period_id:per,sent_on:'2026-12-06'});
 await assert.rejects(command({op:'set_month_marks',period_id:per,sent_on:'2026-12-09'}),/причину повторной отправки/);
 await command({op:'set_month_marks',period_id:per,sent_on:'2026-12-09',sent_note:'ТН изменил объём субподрядчика'});
 await command({op:'set_month_marks',period_id:per,equipment_expected:true});
 let mm=(await db.query('select * from pto_month_marks_current where period_id=$1',[per])).rows[0];
 assert.deepEqual([mm.sent_on.toISOString().slice(0,10),mm.first_sent_on.toISOString().slice(0,10),mm.sent_note,mm.equipment_expected],['2026-12-09','2026-12-06','ТН изменил объём субподрядчика',true]);
 // Части договора.
 const living=(await command({op:'set_contract_part',contract_id:our,name:'Жилая часть',vat_rate:'20',amount:'1000000.00'})).part_id;
 const shops=(await command({op:'set_contract_part',contract_id:our,name:'Встроенные помещения',vat_rate:'0'})).part_id;
 const foreign=(await command({op:'set_contract_part',contract_id:other,name:'Чужая часть'})).part_id;
 await assert.rejects(command({op:'set_contract_part',contract_id:our,name:' '}),/название части/);
 await command({op:'set_contract_part',part_id:shops,name:'Встроенные помещения (без НДС)'});
 assert.deepEqual((await db.query('select name,vat_rate,ordinal from pto_contract_parts where contract_id=$1 order by ordinal',[our])).rows.map(r=>[r.name,r.vat_rate,r.ordinal]),[['Жилая часть','20.00',1],['Встроенные помещения (без НДС)','0.00',2]]);
 await assert.rejects(db.query('delete from pto_contract_parts where id=$1',[living]),/permission denied/);
 const a1=(await op('create_document',{contract_id:our,kind:'c2a',number:'1',amount:'700.00'})).document_id;
 const a2=(await op('create_document',{contract_id:our,kind:'c2a',number:'2',amount:'200.00'})).document_id;
 const a3=(await op('create_document',{contract_id:our,kind:'c2a',number:'3',amount:'100.00'})).document_id;
 await assert.rejects(command({op:'set_document_mark',document_id:a1,part_id:foreign}),/не относится к договору/);
 await command({op:'set_document_mark',document_id:a1,part_id:living});
 await command({op:'set_document_mark',document_id:a2,part_id:shops});
 assert.equal((await db.query('select part from pto_document_marks_current where document_id=$1',[a2])).rows[0].part,'Встроенные помещения (без НДС)');
 await op('create_document',{contract_id:our,kind:'c3a',number:'С-3а'});
 for(const d of [a1,a2,a3])await pass(d);
 const rows=(await db.query('select public.pto_register_matrix($1) m',[month])).rows[0].m.rows.filter(r=>r.project_id===pid);
 assert.deepEqual(rows.map(r=>[r.kind,r.part||'',r.total]),[['part','Жилая часть','700.00'],['part','Встроенные помещения (без НДС)','200.00'],['part','Часть не указана','100.00'],['contract','','1000.00']]);
 assert.equal(rows[1].vat_rate,'0.00');assert.equal(rows[3].has_parts,true);
 await as(users.director);await assert.rejects(command({op:'set_contract_part',contract_id:our,name:'Ещё'}),/Недостаточно прав/);
 assert.equal((await db.query('select count(*) from pto_contract_parts where contract_id=$1',[our])).rows[0].count,2,'руководитель читает части');
});
test('contracts import: objects, counterparties by UNP, unchecked contracts, addenda, parts; existing contract only gets empty fields',async()=>{
 await as(users.head);
 const pid=(await command({op:'create_project',name:'Импорт'})).project_id;
 await command({op:'create_contract',project_id:pid,number:'7',party:'Ручной',direction:'incoming',subject:'введено вручную'});
 const item=(x)=>({our_role:'customer',counterparty_role:'subcontractor',addenda:[],parts:[],files:[],...x});
 const r=await command({op:'import_contracts',contracts:[
  item({key:'ИМПОРТ/07',object:'Импорт',number:'7',subject:'из файла',amount:'1000.00',work_end:'2026-12-31',checked:false}),
  item({key:'НОВЫЙ/01',object:'Новый объект',number:'1',unp:'123456789',party:'ООО «Ромашка»',party_full_name:'Общество «Ромашка»',type:'su22_sub',checked:false,
   amount:'500.00',files:[{type:'contract',path:'НОВЫЙ/01/Договор.pdf'}],parts:[{name:'Жилая',vat_rate:'20',amount:'300.00'},{name:'Встроенные',vat_rate:'0',amount:'200.00'}],
   addenda:[{number:'1',date:'2026-05-01',amount_after:'600.00',signed:null},{number:'2',date:null},{number:'3',date:'2026-06-01',signed:false}]}),
  item({key:'НОВЫЙ/00',object:'Новый объект',number:'00',our_role:'subcontractor',counterparty_role:'general_contractor',party:'МПС',type:'su22_mps',checked:true}),
  item({key:'НОВЫЙ/02',object:'Новый объект',number:'2',party:'Без УНП',parent_number:'00',type:'su22_sub',checked:true}),
  item({key:'НОВЫЙ/bad',object:'Новый объект',number:'3',party:'Плохой',our_role:'customer',counterparty_role:'customer'})]});
 assert.deepEqual([r.projects,r.parties,r.created,r.updated,r.addenda,r.addenda_skipped,r.parts],[1,1,3,1,2,1,2]);
 assert.deepEqual(r.skipped.map(x=>[x.key,x.reason]),[['НОВЫЙ/bad','несовместимые роли сторон']]);
 const manual=(await db.query("select * from pto_contracts where project_id=$1 and number='7'",[pid])).rows[0];
 assert.deepEqual([manual.subject,manual.initial_amount,manual.source_key,manual.checked],['введено вручную','1000.00','ИМПОРТ/07',true],'ручное не перезаписано, пустое заполнено, отметка «проверен» не снята');
 const np=(await db.query("select id from pto_projects where name='Новый объект'")).rows[0].id;
 const c1=(await db.query("select * from pto_contract_list where project_id=$1 and number='1'",[np])).rows[0];
 assert.deepEqual([c1.checked,c1.contract_type,c1.files[0].path,c1.current_amount,c1.party],[false,'su22_sub','НОВЫЙ/01/Договор.pdf','600.00','ООО «Ромашка»']);
 assert.deepEqual((await db.query('select number,status from pto_contract_addenda where contract_id=$1 order by number',[c1.id])).rows.map(x=>[x.number,x.status]),[['1','signed'],['3','draft']]);
 assert.equal((await db.query('select count(*)::int n from pto_contract_parts where contract_id=$1',[c1.id])).rows[0].n,2);
 const c2=(await db.query("select c.parent_contract_id,p.number from pto_contracts c join pto_contracts p on p.id=c.parent_contract_id where c.source_key='НОВЫЙ/02'")).rows[0];
 assert.equal(c2.number,'00','основной договор найден по номеру');
 // Повторная загрузка того же файла ничего не дублирует.
 const again=await command({op:'import_contracts',contracts:[item({key:'НОВЫЙ/01',object:'Новый объект',number:'1',unp:'123456789',party:'ООО «Ромашка»',addenda:[{number:'1',date:'2026-05-01'}]})]});
 assert.deepEqual([again.created,again.updated,again.addenda,again.projects,again.parties],[0,1,0,0,0]);
 await command({op:'member',project_id:np,user_id:users.engineer});
 await as(users.engineer);
 await assert.rejects(command({op:'import_contracts',contracts:[]}),/начальник ПТО/);
 await command({op:'set_contract_checked',contract_id:c1.id,checked:true});
 assert.equal((await db.query('select checked from pto_contracts where id=$1',[c1.id])).rows[0].checked,true);
});
