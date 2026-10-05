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
// Маршрут комплекта (шаг 6): документы не переходят по одному, комплект движется по шагам шаблона.
async function docRow(d){return (await db.query('select d.*,wd.workflow_id from pto_documents d join pto_workflow_documents wd on wd.document_id=d.id where d.id=$1',[d])).rows[0];}
async function periodRev(per){return (await db.query('select revision from pto_periods where id=$1',[per])).rows[0].revision;}
async function attachFile(d){const r=await docRow(d);const path=`${r.project_id}/${d}/${r.current_version}/${randomUUID()}.pdf`;await db.query("insert into storage.objects(bucket_id,name) values('pto-documents',$1)",[path]);await command({op:'attach',period_id:r.period_id,expected_revision:await periodRev(r.period_id),document_id:d,path,name:'Скан.pdf'});}
async function stepOf(w){return (await db.query('select step_code from pto_workflows where id=$1',[w])).rows[0].step_code;}
const advance=(w,extra={})=>command({op:'workflow_advance',workflow_id:w,person:'Ответственный',method:'Лично',proof:'Подтверждение по описи',...extra});
// Прогоняет комплект документа до шага upTo, прикладывая файлы, где их нет (действует текущий пользователь).
async function pass(d,upTo='accepted'){
 const w=(await docRow(d)).workflow_id;
 const docs=(await db.query('select d.id from pto_workflow_documents wd join pto_documents d on d.id=wd.document_id where wd.workflow_id=$1 and not exists(select 1 from pto_files f where f.version_id=d.current_version)',[w])).rows;
 for(const x of docs)await attachFile(x.id);
 for(let i=0;i<12&&await stepOf(w)!==upTo;i++)await advance(w);
 assert.equal(await stepOf(w),upTo);return w;
}
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
test('kit route: steps from the template, roles per step, returns with reason, acceptance of the whole kit',async()=>{
 await as(users.head);await command({op:'member',project_id:project,user_id:users.accountant});
 await as(users.engineer);doc=await create('c2b','1');
 const w=(await docRow(doc)).workflow_id;assert.equal(await stepOf(w),'prepared');
 await assert.rejects(advance(w),/акты и одна С-3а/);
 summary=await create('c3a','1','999');
 assert.equal((await docRow(summary)).workflow_id,w,'С-3а попадает в тот же комплект');
 assert.equal((await db.query('select v.amount from pto_versions v join pto_documents d on d.current_version=v.id where d.id=$1',[summary])).rows[0].amount,'100.00');
 await assert.rejects(command({op:'workflow_advance',workflow_id:w,person:'Прораб',expected_revision:(await rev())-1}),/Данные уже изменились/);
 await assert.rejects(advance(w,{person:''}),/кому передан/);
 await advance(w);await advance(w);
 await assert.rejects(advance(w,{method:''}),/способ передачи/);
 await advance(w);await advance(w);assert.equal(await stepOf(w),'signed');
 await assert.rejects(advance(w),/файл к каждому документу/);
 await assert.rejects(run('send',{document_id:doc,person:'Прораб',proof:'Опись',method:'Лично'}),/по маршруту комплекта/);
 await attachFile(doc);await attachFile(summary);await advance(w);await advance(w);assert.equal(await stepOf(w),'accounting');
 await assert.rejects(advance(w),/бухгалтерия/);
 await as(users.accountant);
 await assert.rejects(command({op:'workflow_return',workflow_id:w,to_step:'signed',note:''}),/причину возврата/);
 await command({op:'workflow_return',workflow_id:w,to_step:'signed',document_id:summary,note:'Нет подписи заказчика на С-3а'});
 const last=(await db.query('select * from pto_workflow_list where id=$1',[w])).rows[0];
 assert.deepEqual([last.step_code,last.attention_document_id,last.last_note],['signed',summary,'Нет подписи заказчика на С-3а']);
 await assert.rejects(advance(w),/ПТО/);
 await as(users.engineer);await advance(w);await advance(w);
 await as(users.accountant);await advance(w);assert.equal(await stepOf(w),'accepted');
 assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),100);
 assert.deepEqual((await db.query('select is_accepted from pto_document_list where workflow_id=$1',[w])).rows.map(r=>r.is_accepted),[true,true]);
 await advance(w);assert.equal(await stepOf(w),'closed');
 await assert.rejects(advance(w),/завершён/);
 const kinds=(await db.query('select kind from pto_workflow_events where workflow_id=$1 order by id',[w])).rows.map(r=>r.kind);
 assert.deepEqual([kinds[0],kinds.filter(k=>k==='return').length],['created',1]);
});
test('a new version keeps the accepted value, sends the kit back and requires a fresh C-3a',async()=>{
 await as(users.head);
 await run('revise',{document_id:doc,amount:'120.50',note:'Уточнение объёма',reason:'Исправление'});
 const w=(await docRow(doc)).workflow_id;
 assert.equal(await stepOf(w),'prepared','комплект вернулся на подготовку');
 assert.equal((await db.query("select note from pto_workflow_events where workflow_id=$1 and kind='reset' order by id desc limit 1",[w])).rows[0].note,'Новая версия документа № 1: Исправление');
 assert.equal(Number((await db.query('select total from pto_register')).rows[0].total),100,'принятая сумма сохраняется');
 assert.equal((await db.query('select * from pto_versions where document_id=$1',[doc])).rows.length,2);
 await assert.rejects(db.query('update pto_versions set amount=1'),/permission denied/);
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
 await as(users.admin);await assert.rejects(run('reopen',{reason:''}),/причину/);await run('reopen',{reason:'Уточнение по письму заказчика'});
 assert.equal((await db.query('select * from pto_snapshots')).rows.length,1);
 await as(users.head);await run('revise',{document_id:doc,amount:'130',reason:'Уточнение'});
 await assert.rejects(run('review'),/не принятые бухгалтерией/);
 await run('revise',{document_id:summary,reason:'По новой версии акта'});await pass(doc);
 await assert.rejects(run('review'),/Обновите справку и С-29/);
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
 const incoming=(await run('create_document',{contract_id:incomingContract,kind:'c2a',number:'С1',amount:'40'})).document_id;
 assert.equal((await db.query('select template_code from pto_workflow_list where id=$1',[(await docRow(incoming)).workflow_id])).rows[0].template_code,'sub_claim');
 await pass(incoming);
 await assert.rejects(run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'NaN',note:'Проверка'}));
 // Субподряд больше выполнения допустим: собственные силы отрицательны и только подсвечиваются (Паркинг, дог. №265).
 await run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'200',note:'Проверка'});
 let neg=(await db.query('select * from pto_register')).rows[0];assert.equal(Number(neg.total)-Number(neg.subcontract),-70);
 await run('allocate',{outgoing_document:doc,incoming_document:incoming,amount:'50',note:'Стоимость сопоставленных работ на заказчика'});
 let r=(await db.query('select * from pto_register')).rows[0];assert.equal(Number(r.total),130);assert.equal(Number(r.subcontract),50);
 await run('revise',{document_id:materials,reason:'Обновлены основания'});await pass(materials);
 await run('review');await run('close');
 await as(users.admin);await run('reopen',{reason:'Уточнение субподрядчика'});
 await as(users.head);await run('revise',{document_id:incoming,amount:'45',reason:'Корректировка'});await pass(incoming);
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
 await as(users.outsider);assert.deepEqual((await db.query('select public.pto_register_matrix($1) m',[month])).rows[0].m.rows,[]);
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
 await as(users.accountant);await assert.rejects(command({...terms}),/Недостаточно прав/);
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
