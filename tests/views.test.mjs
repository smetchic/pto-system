import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWorkspace} from '../src/views.js';

function fixture(role='head') {
 const profile={id:'user',display_name:'Тестовый сотрудник',role,active:true};
 const data={
  projects:[{id:'object',name:'Объект <script>alert(1)</script>',address:'Адрес & корпус'}],
  contracts:[{id:'contract',project_id:'object',number:'Д-1',party:'Контрагент',direction:'outgoing'}],
  periods:[{id:'period',project_id:'object',status:'open',revision:2,reviewed_revision:1}],
  profiles:[profile],memberships:[{project_id:'object',user_id:'user'}],allocations:[],events:[],
  documents:[{id:'act',project_id:'object',period_id:'period',contract_id:'contract',kind:'c2a',number:'1',current_version:'new',accepted_version:'old',due_date:'2026-10-10',workflow_id:'kit',step_code:'acts',step_label:'Готовятся акты'}],
  templates:[{code:'claim',name:'Процентовка заказчику',money:true,ordinal:1},{code:'c29',name:'С-29',money:false,ordinal:3}],
  steps:[['wait','Ждём объёмы'],['acts','Готовятся акты'],['tn','У технадзора'],['check','На проверке'],['signed','Проверено'],['accepted','В бухгалтерии']].map(([code,label],i)=>({template_code:'claim',code,ordinal:i+1,label,actor:code==='accepted'?'none':'pto',requires:[]})),
  workflows:[{id:'kit',template_code:'claim',template_name:'Процентовка заказчику',money:true,project_id:'object',project:'Объект <script>alert(1)</script>',period_id:'period',contract_id:'contract',contract_number:'Д-1',party:'Контрагент',
   step_code:'acts',step_label:'Готовятся акты',step_ordinal:2,actor:'pto',documents:1,acts_amount:'9999.00',open_notes:[{id:7,note:'Нет подписи <i>',source:'технадзор',round:2,date:'2026-10-05'}],step_since:new Date(Date.now()-3*86400000).toISOString(),step_dates:{wait:'2026-10-02'}}],
  versions:[{id:'new',document_id:'act',amount:9999,version:2},{id:'old',document_id:'act',amount:100,version:1}],
  register:[{period_id:'period',project_id:'object',contract_id:'contract',number:'Д-1',total:100,subcontract:25}],
  matrix:{columns:[{id:'sub',label:'Субподрядчик <b>',total:'25.00'}],
   rows:[{kind:'contract',project_id:'object',project:'Объект <script>alert(1)</script>',contract_id:'contract',number:'Д-1',total:'100.00',own:'75.00',subcontract:'25.00',cells:{sub:'25.00'}}],
   total:{total:'100.00',own:'75.00',subcontract:'25.00',cells:{sub:'25.00'}}}
 };
 return {profile,data,ui:{route:'today',month:'2026-10',project:'object',projectTab:'summary',theme:'system'}};
}

test('all workspace routes render empty and populated data with escaped user content',()=>{
 for(const empty of [false,true]){
  const ctx=fixture();if(empty)for(const key of Object.keys(ctx.data))ctx.data[key]=[];
  for(const route of ['today','objects','project','flow','register','documents','audit','team','deadlines','parties','settings','help']){
   ctx.ui.route=route;const html=renderWorkspace(ctx);
   assert.match(html,/<main>/,route);assert.doesNotMatch(html,/<script>|\bNaN\b|\bundefined\b/,route);
  }
  if(!empty){ctx.ui.route='objects';assert.match(renderWorkspace(ctx),/&lt;script&gt;/);}
 }
});

test('dashboard financial bars retain accepted values while the new draft is in the conveyor',()=>{
 const ctx=fixture();let html=renderWorkspace(ctx);
 assert.match(html,/Выполнение за месяц, 100,00 руб/);
 assert.match(html,/Своими силами 75,00, субподряд 25,00/);
 assert.doesNotMatch(html,/9[\s\u00a0]999,00/);
 ctx.ui.route='flow';html=renderWorkspace(ctx);assert.match(html,/9[\s\u00a0]999,00/);
 ctx.ui.flowProject='another-object';assert.doesNotMatch(renderWorkspace(ctx),/data-id="kit"/);
});

test('conveyor: six shared columns, card opens the side panel, no step button; "your move" only for the acting role',()=>{
 const ctx=fixture();ctx.ui.route='flow';let html=renderWorkspace(ctx);
 for(const label of ['Ждём объёмы','Готовятся акты','У технадзора','На проверке','Проверено','В бухгалтерии'])assert.match(html,new RegExp(label));
 assert.match(html,/class="cv-card"[^>]*data-action="workflow" data-id="kit"/,'клик по карточке открывает панель');
 assert.doesNotMatch(html,/data-action="wf-advance"/,'кнопки шага на карточке нет');
 assert.match(html,/Ваш ход: передать технадзору/);
 assert.match(html,/cv-flag">Нет подписи &lt;i&gt;, 2-й круг/);assert.match(html,/cv-corner/);assert.match(html,/<i class="bad">2<\/i>/,'точка шага красная при замечании');
 assert.doesNotMatch(html,/<script>alert/);
 {const d=fixture('director');d.ui.route='flow';assert.doesNotMatch(renderWorkspace(d),/Ваш ход:/,'руководитель шаги не делает');}
 {const other=fixture('engineer');other.data.memberships=[];other.ui.route='flow';const h=renderWorkspace(other);assert.match(h,/data-id="kit"/,'инженер видит конвейер чужого объекта');assert.doesNotMatch(h,/Ваш ход:/,'но шаги не делает');}
 ctx.ui.flowKind='c29';html=renderWorkspace(ctx);assert.doesNotMatch(html,/data-id="kit"/,'фильтр вида');
 ctx.ui.flowKind='';assert.match(html=renderWorkspace(ctx),/data-action="expected" data-id="c29:contract"/,'ожидаемая С-29 открывает панель');
 ctx.data.skips=[{template_code:'c29',project_id:'object',contract_id:'contract'}];assert.doesNotMatch(renderWorkspace(ctx),/data-id="c29:contract"/,'снятое ожидание не показывается');
 Object.assign(ctx.data.workflows[0],{step_code:'accepted',step_ordinal:6,step_label:'В бухгалтерии',actor:'none',open_notes:[]});html=renderWorkspace(ctx);
 assert.match(html,/data-action="workflow" data-id="kit"/,'в «В бухгалтерии» карточки, а не только счётчик');assert.doesNotMatch(html,/Ваш ход: передать/,'после передачи шагов нет');
});

test('Today lists kits awaiting PTO with the remark and the next move; transferred kits need no action',()=>{
 const ctx=fixture();let html=renderWorkspace(ctx);
 assert.match(html,/Требует действий ПТО/);assert.match(html,/Процентовка заказчику · Готовятся акты/);assert.match(html,/3 дн\./);
 assert.match(html,/замечание: Нет подписи &lt;i&gt;/);assert.match(html,/Ваш ход: передать технадзору/);
 assert.doesNotMatch(html,/У бухгалтерии/);
 Object.assign(ctx.data.workflows[0],{step_code:'accepted',actor:'none'});html=renderWorkspace(ctx);
 assert.match(html,/Нет комплектов, ожидающих действий ПТО/);
 assert.doesNotMatch(html,/data-action="view-as"|Бухгалтерия<\/button>/);
});

test('negative own forces are shown and highlighted, not hidden',()=>{
 const ctx=fixture();ctx.data.register[0].subcontract=324.58;
 ctx.data.matrix.rows[0].own=ctx.data.matrix.total.own='-224.58';
 for(const route of ['register','objects']){ctx.ui.route=route;ctx.ui.portfolioView='table';
  assert.match(renderWorkspace(ctx),/class="num neg"[^>]*>-224,58</,route);}
 ctx.ui.route='project';ctx.ui.projectTab='month';assert.match(renderWorkspace(ctx),/class="neg"[^>]*>(≈ )?-224,58</);
});

test('register renders the database matrix: sub-contract columns, object subtotal and total without client sums',()=>{
 const ctx=fixture();ctx.ui.route='register';
 const m=ctx.data.matrix;m.columns.push({id:'sub2',label:'Мегалит · №7',total:'0.01'});
 m.rows.push({kind:'contract',project_id:'object',project:'Объект',contract_id:'c2',number:'Д-2',total:'0.10',own:'0.09',subcontract:'0.01',cells:{sub2:'0.01'}},
  {kind:'project',project_id:'object',project:'Объект',total:'100.10',own:'75.09',subcontract:'25.01',cells:{sub:'25.00',sub2:'0.01'}});
 m.total={total:'999.99',own:'975.00',subcontract:'24.99',cells:{sub:'25.00',sub2:'0.01'}};
 const html=renderWorkspace(ctx);
 assert.match(html,/Субподрядчик &lt;b&gt;/);assert.match(html,/Мегалит · №7/);
 assert.match(html,/Итого по объекту/);
 // Итог берётся из матрицы, а не складывается в браузере (100,00 + 0,10 ≠ 999,99).
 assert.match(html,/<td>Итого<\/td><td class="num">999,99</);
});

test('register shows the operative estimate separately and marks the basis of accepted sums',()=>{
 const ctx=fixture();ctx.ui.route='register';let html=renderWorkspace(ctx);
 assert.doesNotMatch(html,/Оценка, предв\./,'без оценок колонки нет');
 Object.assign(ctx.data.matrix.rows[0],{estimate:'150.00',basis:'acts'});ctx.data.matrix.total.estimate='150.00';
 html=renderWorkspace(ctx);
 assert.match(html,/Оценка, предв\./);assert.match(html,/<td class="num muted">150,00</);
 assert.match(html,/по актам, С-3а не принята/);
 ctx.data.matrix.rows[0].basis='c3a';assert.match(renderWorkspace(ctx),/Итого по договору · по С-3а/);
 ctx.ui.route='project';ctx.ui.projectTab='month';assert.match(renderWorkspace(ctx),/Оценка выполнения<\/b><span>150,00 · предварительно/);
});

test('contracts tab shows computed current price and term and opens the contract card',()=>{
 const ctx=fixture();ctx.ui.route='project';ctx.ui.projectTab='contracts';
 Object.assign(ctx.data.contracts[0],{current_amount:'159559.72',amount_addendum_number:'1',current_end_date:'2000-01-31'});
 ctx.data.addenda=[{id:'a2',contract_id:'contract',number:'2',status:'draft'}];
 const html=renderWorkspace(ctx);
 assert.match(html,/data-action="contract" data-id="contract"/);
 assert.match(html,/159[\s ]559,72<small>по ДС № 1 · ДС № 2 в работе/);
 assert.match(html,/Истёк · 31\.01\.2000/);
 ctx.data.contracts[0].current_amount=null;assert.match(renderWorkspace(ctx),/<td class="num"><span class="muted">—<\/span>/);
});

test('object page: work actions follow role and period; steps stay in the side panel',()=>{
 for(const [role,assigned] of [['head',false],['engineer',true],['engineer',false],['director',true]]){
  const ctx=fixture(role);ctx.ui.route='project';if(!assigned)ctx.data.memberships=[];
  const writer=role==='head'||(role==='engineer'&&assigned);
  ctx.ui.projectTab='documents';assert.equal(renderWorkspace(ctx).includes('data-action="new-doc"'),writer,role);
  ctx.ui.projectTab='contracts';assert.equal(renderWorkspace(ctx).includes('data-action="new-contract"'),writer,role);
  ctx.ui.projectTab='month';let html=renderWorkspace(ctx);
  assert.equal(html.includes('data-action="close"'),role==='head',role);
  assert.equal(html.includes('Ваш ход'),writer,role);
  assert.match(html,/data-action="workflow" data-id="kit"/,'дело открывает боковую панель');
  assert.doesNotMatch(html,/data-action="sp-mode"/,'кнопок шага на странице нет');
  ctx.data.periods[0].status='closed';
  for(const tab of ['month','contracts','documents','history']){ctx.ui.projectTab=tab;html=renderWorkspace(ctx);
   assert.doesNotMatch(html,/data-action="new-doc"|data-action="close"/,tab);}
  ctx.ui.projectTab='month';assert.equal(renderWorkspace(ctx).includes('data-action="reopen"'),role==='head');
 }
});

test('counterparties: list with roles and contract count, search text, read-only card for the director, payload with roles',async()=>{
 const {partiesList,partyCard,partyPayload,partySearchText}=await import('../src/parties.js');
 const party={id:'cp1',unp:'190000001',short_name:'ООО <Мегалит>',full_name:'Общество «Мегалит»',address:'Минск',status_name:'Действующий',source:'МНС XML',director_name:'Иванов'};
 const data={parties:[party],partyRoles:[{counterparty_id:'cp1',role:'subcontractor'}],participants:[{counterparty_id:'cp1',project_id:'object',role:'subcontractor'}],
  contracts:[{id:'k1',counterparty_id:'cp1',project_id:'object',number:'21',our_role:'customer',current_amount:'1000.50'}],projects:[{id:'object',name:'Пружаны'}]};
 let html=partiesList({data,canEdit:true});
 assert.match(html,/data-action="party" data-id="cp1"/);assert.match(html,/ООО &lt;Мегалит&gt;/);assert.doesNotMatch(html,/<Мегалит>/);
 assert.match(html,/Субподрядчик/);assert.match(html,/<td class="num">1<\/td>/);assert.match(html,/data-action="new-party"/);
 assert.doesNotMatch(partiesList({data,canEdit:false}),/data-action="new-party"/,'руководитель не добавляет контрагентов');
 assert.match(partySearchText(data,party),/190000001/);assert.match(partySearchText(data,party),/субподрядчик/);
 html=partyCard({data,party,canEdit:true,today:'2026-10-07'});
 assert.match(html,/Пружаны/);assert.match(html,/1[\s ]000<small>,50<\/small>/);assert.match(html,/Иванов/);
 assert.match(html,/data-action="party-edit"/);assert.doesNotMatch(html,/<input name=/,'просмотр без полей ввода');
 assert.match(html,/data-action="copy" data-id="190000001"/,'УНП копируется');
 assert.match(html,/Нет сведений МНС/);assert.match(html,/Для договора не хватает индекса, счёта/);
 assert.match(html,/Контактные лица/);assert.match(html,/data-action="party-contact-new"/);
 html=partyCard({data,party,canEdit:true,editing:true});
 assert.match(html,/type="submit"/);assert.match(html,/name="roles" value="subcontractor" checked/);assert.match(html,/type="hidden" name="unp" value="190000001"/);assert.match(html,/name="postal_code"/);
 const ro=partyCard({data,party,canEdit:false,editing:true});
 assert.doesNotMatch(ro,/type="submit"|party-edit|party-contact-new|<input name=/,'руководитель только смотрит');assert.match(ro,/Иванов/);
 assert.match(partyCard({data,canEdit:true}),/Новый контрагент[\s\S]*name="unp"[\s\S]*type="submit"/);
 assert.match(partyCard({data,canEdit:true}),/type="hidden" name="status_name" value=""/,'ручное добавление отправляет пустые поля МНС');
 const liq=partyCard({data,party:{...party,status_name:'Ликвидирован',status_change_date:'2026-10-30'},canEdit:false});
 assert.match(liq,/cp-mark bad"><i><\/i>Ликвидирован с 30\.10\.2026/);assert.match(liq,/Не заключать новые договоры/);
 const form=new FormData();form.append('unp','190000001');form.append('roles','customer');form.append('roles','supplier');form.append('note','x');
 assert.deepEqual(partyPayload(form,party),{unp:'190000001',note:'x',roles:['customer','supplier'],op:'update_counterparty',counterparty_id:'cp1'});
 assert.equal(partyPayload(new FormData()).op,'create_counterparty');
});

test('counterparty card: МНС freshness, requisites in contract order, contacts with objects',async()=>{
 const {partyMarks,partyRequisitesText,contactCard,contactPayload,partyCard}=await import('../src/parties.js');
 const c={id:'cp1',unp:'693340482',short_name:'ООО "КИПМОНТАЖ"',full_name:'Общество с ограниченной ответственностью "КИПМОНТАЖ"',address:'Минский р-н, д. 62',postal_code:'223053',status_name:'Действующий',
  mns_checked_at:'2026-08-20',bank_account:'BY20AKBB30120000000000000000',bank_name:'ОАО «АСБ Беларусбанк»',bank_bic:'AKBBBY2X',okpo:'512345678',phone:'+375 17 222-33-44',email:'info@k.by',
  director_title:'Директор',director_name:'Петров Пётр Петрович',authority_basis:'Устава'};
 assert.deepEqual(partyMarks(c,'2026-10-07').map(m=>m[0]+':'+m[1]),['ok:Действующий','warn:Сведения МНС 48 дней назад','ok:Реквизиты для договора заполнены']);
 assert.equal(partyMarks(c,'2026-09-01')[1][0],'ok');
 assert.equal(partyRequisitesText(c),['Общество с ограниченной ответственностью "КИПМОНТАЖ"','Юр. адрес: 223053, Минский р-н, д. 62','р/с BY20 AKBB 3012 0000 0000 0000 0000 в ОАО «АСБ Беларусбанк», BIC AKBBBY2X','УНП 693340482, ОКПО 512345678','тел. +375 17 222-33-44, e-mail info@k.by','Директор _______________ П.П. Петров'].join('\n'));
 const data={parties:[c],projects:[{id:'p1',name:'Пружаны'},{id:'p2',name:'Паркинг'}],partyContacts:[{id:'k1',counterparty_id:'cp1',name:'Сидоренко Ольга',position:'Инженер ПТО',topics:'Процентовки',project_ids:['p1'],phone:'+375 29 555-12-34',email:'o@k.by'}],contracts:[],partyRoles:[],participants:[]};
 const html=partyCard({data,party:c,canEdit:true,today:'2026-10-07'});
 assert.match(html,/Сидоренко Ольга[\s\S]*Процентовки[\s\S]*Инженер ПТО · Пружаны/);assert.match(html,/data-action="copy" data-id="o@k.by"/);
 assert.match(html,/data-action="copy" data-id="Общество[^"]*\nЮр. адрес/,'кнопка копирует текст реквизитов');
 const form=contactCard({data,party:c,contact:data.partyContacts[0]});
 assert.match(form,/name="project_ids" value="p1" checked/);assert.match(form,/party-contact-delete/);
 const fd=new FormData();fd.append('name','Бухгалтерия');fd.append('counterparty_id','cp1');fd.append('contact_id','');fd.append('project_ids','p2');
 assert.deepEqual(contactPayload(fd),{op:'save_counterparty_contact',name:'Бухгалтерия',counterparty_id:'cp1',project_ids:['p2']});
});

test('MNS XML: parsed without DOM, compared by UNP, manual fields are not part of the diff',async()=>{
 const {parseMnsXml,mnsPreview,mnsPreviewHtml}=await import('../src/parties.js');
 const xml='<ROWSET><ROW><VUNP>693340482</VUNP><VNAIMP>Общество с ограниченной ответственностью &quot;КИПМОНТАЖ&quot;</VNAIMP><VNAIMK>ООО "КИПМОНТАЖ"</VNAIMK><VPADRES>Минский район</VPADRES><DREG>2024-11-04</DREG><NMNS>613</NMNS><VMNS>Инспекция МНС РБ по Минскому району</VMNS><CKODSOST>1</CKODSOST><VKODS>Действующий</VKODS><DLIKV/><VLIKV/></ROW><ROW><VUNP>190000001</VUNP><VNAIMP>ООО «Новый &amp; Ко»</VNAIMP><VNAIMK/><VPADRES>Минск</VPADRES><DREG>01.02.2020</DREG><NMNS>104</NMNS><VMNS>ИМНС</VMNS><CKODSOST>3</CKODSOST><VKODS>Ликвидирован</VKODS><DLIKV>2026-09-30</DLIKV><VLIKV>Решение</VLIKV></ROW></ROWSET>';
 const rows=parseMnsXml(xml);
 assert.equal(rows.length,2);
 assert.deepEqual([rows[0].unp,rows[0].full_name,rows[0].status_change_date,rows[1].full_name,rows[1].short_name,rows[1].registration_date],['693340482','Общество с ограниченной ответственностью "КИПМОНТАЖ"','','ООО «Новый & Ко»','','2020-02-01']);
 assert.throws(()=>parseMnsXml('<html></html>'),/ROWSET/);
 const existing={id:'k',...rows[0],director_name:'Петров',status_name:'Действующий'};
 const data={parties:[existing]};
 let p=mnsPreview(data,rows);
 assert.deepEqual(p.map(x=>x.status),['same','new']);
 p=mnsPreview(data,[{...rows[0],status_name:'Ликвидирован',status_code:'3'},rows[0]]);
 assert.equal(p.length,1,'повтор УНП — одна строка, последняя выписка');
 p=mnsPreview(data,[{...rows[0],status_name:'Ликвидирован',status_code:'3'}]);
 assert.deepEqual(p[0].changes.map(c=>c.field),['status_code','status_name']);
 const html=mnsPreviewHtml(mnsPreview(data,[{...rows[0],status_name:'Ликвидирован'},rows[1]]));
 assert.match(html,/Новых: <b>1<\/b> · с изменениями: <b>1<\/b>/);assert.match(html,/Действующий → <b>Ликвидирован<\/b>/);assert.match(html,/Новый &amp; Ко/);
});
test('settings offer text size and mark the current one',()=>{
 const ctx=fixture();const html=renderWorkspace({...ctx,ui:{...ctx.ui,route:'settings',textScale:115}});
 for(const scale of ['100','115','130'])assert.match(html,new RegExp(`data-action="text-scale" data-id="${scale}"`));
 assert.match(html,/data-id="115" aria-pressed="true"/);
});
