import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
let db, project, otherProject, period, contract, doc, summary, materials;
const users={head:randomUUID(),engineer:randomUUID(),outsider:randomUUID(),admin:randomUUID(),accountant:randomUUID()};
async function as(user) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]); await db.exec('set role authenticated'); }
async function command(payload,request=randomUUID()){const r=await db.query('select public.pto_command($1,$2::jsonb) result',[request,JSON.stringify(payload)]);return r.rows[0].result;}
async function rev(){return (await db.query('select revision from pto_periods where id=$1',[period])).rows[0].revision;}
async function run(op,extra={}){return command({op,period_id:period,expected_revision:await rev(),...extra});}
async function create(kind,number,amount='100.00'){return (await run('create_document',{contract_id:contract,kind,number,amount})).document_id;}
async function attach(d){const v=(await db.query('select current_version from pto_documents where id=$1',[d])).rows[0].current_version;const path=`${project}/${d}/${v}/${randomUUID()}.pdf`;await db.query("insert into storage.objects(bucket_id,name) values('pto-documents',$1)",[path]);await run('attach',{document_id:d,path,name:'Акт.pdf'});}
async function accept(d){await attach(d);for(const op of ['send','receive','sign','accept'])await run(op,{document_id:d,person:'Ответственный',proof:'Подтверждение получения или подписи',method:'Лично'});}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const migration of (await readdir(new URL('../supabase/migrations/',import.meta.url))).sort()) await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 for(const [name,id] of Object.entries(users)){await db.query('insert into auth.users values($1,$2)',[id,`${name}@test.invalid`]);await db.query('update pto_profiles set active=true,role=$2 where id=$1',[id,['engineer','outsider'].includes(name)?'engineer':name]);}
});
after(async()=>db?.close());
test('create workspace, object scope, memberships and idempotent commands',async()=>{
 await as(users.head);const req=randomUUID(),payload={op:'create_project',name:'Объект 1'};
 const first=await command(payload,req);assert.deepEqual(await command(payload,req),first);project=first.project_id;
 await assert.rejects(command({...payload,name:'Подмена'},req),/уже использован/);
 otherProject=(await command({op:'create_project',name:'Другой объект'})).project_id;
 await command({op:'member',project_id:project,user_id:users.engineer});
 await as(users.engineer);assert.equal((await db.query('select * from pto_projects')).rows.length,1);
 await assert.rejects(command({op:'open_period',project_id:otherProject,month:'2026-10-01'}),/Нет доступа/);
 await assert.rejects(db.query("update pto_profiles set role='admin' where id=$1",[users.engineer]),/permission denied/);
 await command({op:'create_contract',project_id:project,number:'Д-1',party:'Заказчик',direction:'outgoing'});
 contract=(await db.query('select id from pto_contracts')).rows[0].id;
 period=(await command({op:'open_period',project_id:project,month:'2026-10-01'})).period_id;
});
test('document versions, transfer receipt and acceptance are separate; reject stale writes',async()=>{
 await as(users.engineer);doc=await create('c2b','1');const revision=await rev();await attach(doc);
 await assert.rejects(command({op:'send',period_id:period,document_id:doc,expected_revision:revision}),/Данные уже изменились/);
 await run('send',{document_id:doc,person:'Прораб',proof:'Передано по описи',method:'Лично'});
 assert.equal((await db.query('select status from pto_documents where id=$1',[doc])).rows[0].status,'sent');
 await assert.rejects(run('accept',{document_id:doc,person:'Бухгалтер',proof:'Приём подтверждён'}),/Недопустимый переход/);
 await run('receive',{document_id:doc,person:'Прораб',proof:'Опись получения'});
 await run('sign',{document_id:doc,person:'Заказчик',proof:'Скан подписанного акта'});
 await assert.rejects(run('accept',{document_id:doc,person:'Бухгалтер',proof:'Принято в учёт'}),/Принятие доступно/);
 await as(users.head);await run('accept',{document_id:doc,person:'Бухгалтер',proof:'Принято в учёт'});
 assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),100);
});
test('new draft preserves accepted financial value and immutable history',async()=>{
 await run('revise',{document_id:doc,amount:'120.50',note:'Уточнение объёма',reason:'Исправление'});
 assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),100);
 assert.equal((await db.query('select * from pto_versions where document_id=$1',[doc])).rows.length,2);
 await assert.rejects(db.query('update pto_versions set amount=1'),/permission denied/);
 await accept(doc);assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),120.5);
});
test('required package blocks review; summary is not double counted; close and reopen retain snapshots',async()=>{
 await assert.rejects(run('review'),/обязательный комплект/);
 summary=await create('c3a','1','120.50');await accept(summary);
 materials=await create('c29','1','0');await accept(materials);
 assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),120.5);
 await run('review');await run('close');
 await assert.rejects(run('revise',{document_id:doc,amount:'5',reason:'Проверка'}),/Период закрыт/);
 assert.equal((await db.query('select * from pto_snapshots')).rows.length,1);
 await as(users.admin);await assert.rejects(run('reopen',{reason:''}),/причину/);await run('reopen',{reason:'Уточнение по письму заказчика'});
 assert.equal((await db.query('select * from pto_snapshots')).rows.length,1);
 await as(users.head);await run('revise',{document_id:doc,amount:'130',reason:'Уточнение'});await accept(doc);
 await assert.rejects(run('review'),/Обновите справку/);
});
test('anonymous and unrelated users cannot read files or documents',async()=>{
 await as(users.head);assert.ok((await db.query('select * from storage.objects')).rows.length>0);
 await as(users.outsider);assert.equal((await db.query('select * from pto_documents')).rows.length,0);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await assert.rejects(command({op:'create_project',name:'Чужой'}),/Недостаточно прав/);
 await db.exec('reset role; set role anon');await assert.rejects(db.query('select * from pto_documents'),/permission denied/);
 await assert.rejects(db.query('select pto_command($1,$2)',[randomUUID(),'{}']),/permission denied/);
});
test('subcontract prices, allocation limits, NaN, and stale source version guards',async()=>{
 await as(users.head);
 await command({op:'create_contract',project_id:project,number:'СУБ-1',party:'Субподрядчик',direction:'incoming'});
 const incomingContract=(await db.query("select id from pto_contracts where direction='incoming'")).rows[0].id;
 const incoming=(await run('create_document',{contract_id:incomingContract,kind:'c2a',number:'С1',amount:'40'})).document_id;await accept(incoming);
 await assert.rejects(run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'NaN',note:'Проверка'}));
 // Субподряд больше выполнения допустим: собственные силы отрицательны и только подсвечиваются (Паркинг, дог. №265).
 await run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'200',note:'Проверка'});
 let neg=(await db.query('select * from pto_register')).rows[0];assert.equal(Number(neg.total)-Number(neg.subcontract),-70);
 await run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'50',note:'Стоимость сопоставленных работ на заказчика'});
 let r=(await db.query('select * from pto_register')).rows[0];assert.equal(Number(r.total),130);assert.equal(Number(r.subcontract),50);
 for(const d of [summary,materials]){await run('revise',{document_id:d,amount:d===summary?'130':'0',reason:'Обновлены основания'});await accept(d);}
 await run('review');await run('close');
 await as(users.admin);await run('reopen',{reason:'Уточнение субподрядчика'});
 await as(users.head);await run('revise',{document_id:incoming,amount:'45',reason:'Корректировка'});await accept(incoming);
 await assert.rejects(run('review'),/распределение субподряда/);
 const before=(await db.query('select data from pto_snapshots order by created_at desc limit 1')).rows[0].data;
 assert.equal(Number(before.register[0].total),130);assert.equal(Number(before.register[0].subcontract),50);
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
 async function act({pid,per},contractId,number,amount,accepted=true){
  const d=(await op(per,'create_document',{contract_id:contractId,kind:'c2a',number,amount})).document_id;if(!accepted)return d;
  const v=(await db.query('select current_version from pto_documents where id=$1',[d])).rows[0].current_version,path=`${pid}/${d}/${v}/${randomUUID()}.pdf`;
  await db.query("insert into storage.objects(bucket_id,name) values('pto-documents',$1)",[path]);await op(per,'attach',{document_id:d,path,name:'Акт.pdf'});
  for(const name of ['send','receive','sign','accept'])await op(per,name,{document_id:d,person:'Ответственный',proof:'Подтверждение',method:'Лично'});
  return d;
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
 await as(users.outsider);assert.deepEqual((await db.query('select public.pto_register_matrix($1) m',[month])).rows[0].m.rows,[]);
 await db.exec('reset role; set role anon');await assert.rejects(db.query('select public.pto_register_matrix($1)',[month]),/permission denied/);
});
test('audit log, process events and snapshots are append-only even for the database owner',async()=>{
 await db.exec('reset role');
 assert.ok((await db.query('select count(*)::int n from pto_events')).rows[0].n>0);
 await assert.rejects(db.query("update pto_events set action='x'"),/только на добавление/);
 await assert.rejects(db.query('delete from pto_events'),/только на добавление/);
 await assert.rejects(db.query('delete from pto_snapshots'),/только на добавление/);
 await assert.rejects(db.query('truncate pto_process_events'),/только на добавление/);
 const cascades=await db.query("select conrelid::regclass::text tbl,conname from pg_constraint where contype='f' and connamespace='public'::regnamespace and confdeltype='c'");
 assert.deepEqual(cascades.rows,[]);
});
