import test from 'node:test';
import assert from 'node:assert/strict';
import {objectPage,closeConditions,termPassed,objectTab} from '../src/object-page.js';

const steps={wait:1,acts:2,tn:3,check:4,signed:5,accepted:6};
const wf=(id,template_code,step_code,extra={})=>({id,template_code,step_code,step_ordinal:steps[step_code],step_label:{wait:'Ждём объёмы',acts:'Готовятся акты',tn:'У технадзора',check:'На проверке',signed:'Проверено',accepted:'В бухгалтерии'}[step_code],
 project_id:'p1',period_id:'per',open_notes:[],step_since:'2026-10-05T10:00:00Z',acts_amount:'0',money:template_code!=='c29',...extra});
function fixture(role='engineer'){
 const profile={id:'u1',display_name:'Надя',role,active:true};
 const data={
  projects:[{id:'p1',name:'Пружаны',full_name:'Жилой дом в г. Пружаны'}],
  profiles:[profile],memberships:[{project_id:'p1',user_id:'u1'}],
  periods:[{id:'per',project_id:'p1',status:'open',revision:3,reviewed_revision:1}],
  contracts:[
   {id:'c21',project_id:'p1',number:'21',party:'Трест',direction:'outgoing',our_role:'subcontractor',counterparty_role:'general_contractor',current_amount:'18640000.00',amount_addendum_number:'3',work_start_date:'2026-01-01',current_end_date:'2026-12-30'},
   {id:'s7',project_id:'p1',number:'7-С',party:'Мегалит',direction:'incoming',our_role:'customer',counterparty_role:'subcontractor'},
   {id:'s12',project_id:'p1',number:'12-С',party:'Стройэлектро',direction:'incoming',our_role:'customer',counterparty_role:'subcontractor'}],
  workflows:[wf('w21','claim','tn',{contract_id:'c21',contract_number:'21',party:'Трест',acts_amount:'1973259.89',step_dates:{wait:'2026-10-02',acts:'2026-10-05'}}),
   wf('w7','sub_claim','check',{contract_id:'s7',party:'Мегалит',acts_amount:'312400.00'})],
  skips:[],documents:[{id:'d1',project_id:'p1',period_id:'per',contract_id:'c21',kind:'c2a',number:'21-10/1',workflow_id:'w21',current_version:'v1',step_code:'tn',step_label:'У технадзора'}],
  versions:[{id:'v1',document_id:'d1',amount:'1973259.89',version:1}],
  matrix:{columns:[],rows:[{kind:'contract',project_id:'p1',contract_id:'c21',number:'21',total:'1973259.89',own:'1503550.42',subcontract:'469709.47'}],total:{total:'1973259.89',own:'1503550.42',subcontract:'469709.47'}},
  prevMatrix:{rows:[{kind:'contract',project_id:'p1',contract_id:'c21',total:'1761839.19',own:'0',subcontract:'0'}]},
  prevWorkflows:[wf('old29','c29','check',{project_id:'p1',contract_id:'c21',template_name:'С-29'})],
  addenda:[{id:'a4',contract_id:'c21',number:'4',status:'draft'}],allocations:[],events:[],
  c3aReports:[{project_id:'p1',is_current:true,to_pay:'1550824.06',smr:'1973259.89',equipment:'731538.30',target_offset:'1153974.13',current_offset:'0'}]
 };
 return {profile,data,ui:{month:'2026-10',project:'p1',projectTab:'month'},today:'2026-10-09',now:Date.parse('2026-10-09T10:00:00Z')};
}

test('month tab: one screen for all steps — step strip, C-3a with the sum check, what the work consists of, documents and subcontractors',()=>{
 const html=objectPage(fixture());
 assert.match(html,/Наша процентовка за октябрь/);assert.match(html,/class="mo-now">У технадзора/);
 assert.match(html,/Ваш ход: отправить заказчику\./);
 assert.match(html,/Отправить заказчику нельзя: не прошли технадзор: Стройэлектро; нет справки С-3а\./);
 assert.match(html,/прошли ТН 1 из 2/);
 assert.match(html,/Ждём процентовку/);
 assert.match(html,/нужна для отправки заказчику/);
 assert.match(html,/= к оплате по С-3а<\/div><div class="mo-big">1[\s ]550[\s ]824,06/);
 assert.match(html,/Сверка сумм: ✓ сходится, есть предварительные/);
 assert.match(html,/<b>Своими силами<\/b> <b class="num">1[\s ]660[\s ]859,89<\/b>/,'всего − субподряд в их ценах');assert.match(html,/субподряд, их цены 312[\s ]400,00/);
 assert.match(html,/· подали 1 из 2/);assert.match(html,/по реестру · предварительно/);
 assert.match(html,/data-action="doc" data-id="d1"/);
 assert.match(html,/С-29 за октябрь/);assert.match(html,/срок 15\.11/);
 assert.doesNotMatch(html,/Хвост|undefined|NaN/);
});

test('month tab: «на заказчика» from the register gives general services; negative own forces are highlighted, not blocked',()=>{
 const ctx=fixture();ctx.data.matrix.rows[0].cells={s7:'312400.00'};ctx.data.matrix.rows[0].customer_cells={s7:'400000.00'};
 let html=objectPage(ctx);
 assert.match(html,/400[\s ]000,00<\/span><\/td><td class="num"><span class="">87[\s ]600,00/);
 assert.match(html,/генуслуги <b class="num cb-ink">87[\s ]600,00/);
 ctx.data.workflows[1].acts_amount='2500000.00';html=objectPage(ctx);
 assert.match(html,/<b class="num neg">-526[\s ]740,11<\/b>/);assert.match(html,/отрицательные, проверьте/);
});

test('month tab: a subcontractor C-3a does not go into our SMR; own forces = our C-3a − subcontract',()=>{
 const ctx=fixture();ctx.data.c3aReports.push({project_id:'p1',contract_id:'s7',is_current:true,to_pay:'8073.53',smr:'8073.53',equipment:'0',target_offset:'0',current_offset:'0'});
 ctx.data.c3aReports[0].contract_id='c21';
 const html=objectPage(ctx);
 assert.match(html,/Выполнено СМР · [^<]*<\/div><div class="mo-big">1[\s ]973[\s ]259,89/);
 assert.match(html,/<b>Своими силами<\/b> <b class="num">1[\s ]660[\s ]859,89<\/b>/);
});

test('director sees the same page without a single action',()=>{
 const html=objectPage(fixture('director'));
 assert.doesNotMatch(html,/Ваш ход|data-action="(estimate|allocate|review|close|open-period)"/);
 assert.match(html,/Проверяет и закрывает начальник ПТО/);
});

test('close conditions and contract term',()=>{
 const {data}=fixture();
 const strict=c=>c.filter(x=>!x.warn).map(x=>x.ok);
 let c=closeConditions(data,'p1','2026-10');assert.deepEqual(strict(c),[false,false,false,false]);
 data.workflows[0].step_code='accepted';data.workflows[1].step_ordinal=4;
 data.workflows.push(wf('w29','c29','accepted',{contract_id:'c21'}));
 data.skips=[{template_code:'sub_claim',contract_id:'s12',project_id:'p1',reason:'нет ДС'}];
 data.periods[0].reviewed_revision=3;
 c=closeConditions(data,'p1','2026-10');assert.deepEqual(strict(c),[true,true,true,true]);
 // «На заказчика» не введено — предупреждение, закрытие не держит (решение 12.10.2026).
 assert.deepEqual(c.filter(x=>x.warn).map(x=>x.text),['«На заказчика» введено у 0 из 1 субподрядчиков · закрыть можно']);
 data.subMonth=[{period_id:data.periods[0].id,contract_id:data.workflows[1].contract_id,on_customer:'10.00'}];
 assert.deepEqual(closeConditions(data,'p1','2026-10').filter(x=>x.warn),[]);
 assert.equal(termPassed({work_start_date:'2026-01-01',current_end_date:'2026-12-31'},'2026-07-02'),50);
 assert.equal(termPassed({current_end_date:'2026-12-31'},'2026-07-02'),null);
 assert.equal(objectTab('summary'),'month');assert.equal(objectTab('history'),'history');
});

test('other tabs: contracts grouped by side, native documents hierarchy, history filtered by kind',()=>{
 const ctx=fixture();ctx.ui.projectTab='contracts';let html=objectPage(ctx);
 assert.match(html,/Наш договор с МПС/);assert.match(html,/Наши исполнители/);
 assert.match(html,/<th>Контрагент<\/th><th>Предмет договора<\/th>/);assert.match(html,/1 в работе/);
 ctx.ui.contractDs=Object.fromEntries(ctx.data.contracts.map(c=>[c.id,true]));assert.match(objectPage(ctx),/<tr class="ct-ds">/);delete ctx.ui.contractDs;assert.match(html,/30\.12\.2026/);
 ctx.data.docMarks=[{document_id:'d1',part:'ЦЕХ (ПРИСТРОЙКА)'}];
 ctx.ui.projectTab='documents';html=objectPage(ctx);
 assert.match(html,/Наша процентовка · дог\. № 21 · Трест/,'тот же заголовок, что во вкладке «Месяц»');assert.match(html,/class="ob-st w">У технадзора/);
 assert.match(html,/Справки С-3а нет<\/span><button type="button" class="link" data-action="new-doc" data-id="c21">\+ акт<\/button><button type="button" class="link" data-action="new-c3a" data-id="c21">\+ справка С-3а/,'добавить — узкая строка ссылок');
 assert.match(html,/class="ob-row kt-act" data-action="doc" data-id="d1"/);assert.match(html,/class="kt-part" title="ЦЕХ \(ПРИСТРОЙКА\)"/,'часть объекта — отдельная колонка');
 assert.match(html,/class="ob-grp kt-section"><td colspan="7">Субподрядчики <span class="muted">· подали 1 из 1/,'только подающие субподрядчики');
 assert.doesNotMatch(html,/Стройэлектро/,'неотмеченный субподрядчик без документов не показывается');
 assert.ok(html.indexOf('Наша процентовка')<html.indexOf('Субподрядчики'),'наши документы всегда выше субподрядчиков');
 assert.doesNotMatch(html,/С-29|справка С-3а выше актов/);
 ctx.ui.projectTab='history';ctx.data.events=[{id:1,project_id:'p1',action:'revise',actor:'u1',created_at:'2026-10-08T10:00:00Z',detail:{reason:'исправлен объём'}},{id:2,project_id:'p1',action:'update_contract',actor:'u1',created_at:'2026-10-08T11:00:00Z',detail:{}}];
 ctx.ui.historyKind='document';html=objectPage(ctx);
 assert.match(html,/исправлен объём/);assert.doesNotMatch(html,/Изменены условия договора/);
});

test('month tab: marks from the database — sub plan grey, «ТН устно», «на заказчика» entered, month and act marks',()=>{
 const ctx=fixture();
 ctx.data.subMonth=[{period_id:'per',contract_id:'s7',tn_status:'oral',on_customer:'350000.00',equipment:'12000.00'},
  {period_id:'per',contract_id:'s12',expected:true,plan:'90000.00'}];
 ctx.data.monthMarks=[{period_id:'per',equipment_expected:true,materials_expected:false}];
 ctx.data.docMarks=[{document_id:'d1',materials:'5000.00',original:'party'}];
 Object.assign(ctx.data.workflows[1],{step_code:'tn',step_ordinal:3,step_label:'У технадзора'});
 const html=objectPage(ctx);
 assert.match(html,/data-action="sub-card" data-id="s7"/);
 assert.match(html,/ТН устно · У технадзора/);
 assert.match(html,/ТН устно: Мегалит · суммы предварительные/);
 assert.match(html,/<span class="mo-w">350[\s ]000,00/);
 assert.match(html,/title="план, уточнится по их акту">90[\s ]000,00/);
 assert.match(html,/aria-checked="true" data-action="month-mark" data-id="equipment"/);
 assert.match(html,/aria-checked="false" data-action="month-mark" data-id="materials"/);
 assert.match(html,/материалы заказчика/);
 assert.doesNotMatch(html,/undefined|NaN/);
});

test('month tab: our acts at the supervisor — counts by TN status, the slowest acts hold the step, «Все наши проверены»',()=>{
 const ctx=fixture();
 ctx.data.documents.push({id:'d2',project_id:'p1',period_id:'per',contract_id:'c21',kind:'c2b',number:'29',workflow_id:'w21',current_version:'v2',step_code:'tn'},
  {id:'d3',project_id:'p1',period_id:'per',contract_id:'c21',kind:'c2b',number:'30',workflow_id:'w21',current_version:'v3',step_code:'tn'});
 ctx.data.versions.push({id:'v2',document_id:'d2',amount:'100.00',version:1},{id:'v3',document_id:'d3',amount:'50.00',version:1});
 ctx.data.docMarks=[{document_id:'d1',tn_status:'ok'},{document_id:'d2',tn_status:'remarks',note:'нет исполнительной'}];
 let html=objectPage(ctx);
 assert.match(html,/у ТН 1 · замечания 1 · подписано 1 из 3 · шаг держат: № 29, № 30/);
 assert.match(html,/data-action="acts-all-ok" data-id="w21">Все акты СУ-22 проверены/);
 assert.match(html,/ТН не подписал акты СУ-22: № 29, № 30/);
 ctx.data.docMarks.push({document_id:'d2',tn_status:'ok'},{document_id:'d3',tn_status:'ok'});ctx.data.docMarks.splice(1,1);
 html=objectPage(ctx);
 assert.match(html,/подписано 3 из 3/);assert.doesNotMatch(html,/acts-all-ok|шаг держат|ТН не подписал/);
 assert.doesNotMatch(objectPage(fixture('director')),/acts-all-ok/);
});

test('month tab: «Отправлено заказчику» on the check step, re-sending shows a rework flag with the reason',()=>{
 const ctx=fixture();Object.assign(ctx.data.workflows[0],{step_code:'check',step_ordinal:4,step_label:'На проверке'});
 let html=objectPage(ctx);
 assert.match(html,/data-action="sent-customer" data-id="">Отправлено заказчику/);
 ctx.data.monthMarks=[{period_id:'per',sent_on:'2026-10-09',first_sent_on:'2026-10-06',sent_note:'ТН изменил Мегалит'}];
 html=objectPage(ctx);
 assert.match(html,/у заказчика с 06\.10/);assert.match(html,/переделка: отправлено повторно 09\.10 · ТН изменил Мегалит/);
 assert.match(objectPage({...fixture('director'),data:{...ctx.data}}),/у заказчика с 06\.10/);
 assert.doesNotMatch(objectPage({...fixture('director'),data:{...ctx.data}}),/sent-customer/);
});

test('«ТН устно» in the subcontractor month card does not hold sending our claim (decision 12.10.2026)',()=>{
 const ctx=fixture();ctx.data.subMonth=[{period_id:'per',contract_id:'s12',tn_status:'oral'}];
 const html=objectPage(ctx);
 assert.match(html,/Отправить заказчику нельзя: нет справки С-3а\./);
 assert.doesNotMatch(html,/не прошли технадзор/);
});
