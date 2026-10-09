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
   {id:'c21',project_id:'p1',number:'21',party:'Трест',direction:'outgoing',our_role:'subcontractor',current_amount:'18640000.00',amount_addendum_number:'3',work_start_date:'2026-01-01',current_end_date:'2026-12-30'},
   {id:'s7',project_id:'p1',number:'7-С',party:'Мегалит',direction:'incoming',our_role:'customer'},
   {id:'s12',project_id:'p1',number:'12-С',party:'Стройэлектро',direction:'incoming',our_role:'customer'}],
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

test('month tab: work of the month with blocked send, parts at the supervisor, tail of last month, money and deadlines',()=>{
 const html=objectPage(fixture());
 assert.match(html,/Работа за октябрь/);
 assert.match(html,/Хвост сентября/);assert.match(html,/data-action="workflow" data-id="old29"/);
 assert.match(html,/Ваш ход: отправить заказчику\./);
 assert.match(html,/Отправить заказчику нельзя: не прошли технадзор: Стройэлектро; нет справки С-3а\./);
 assert.match(html,/субподрядчики прошли технадзор 1 из 2/);
 assert.match(html,/Ждём процентовку/);
 assert.match(html,/Справка С-3а<\/td><td class="n muted">нужна для отправки заказчику/);
 assert.match(html,/≈ 1[\s ]503[\s ]550,42/,'своими силами предварительно: подали не все');
 assert.match(html,/подали 1 из 2/);
 assert.match(html,/▲ 12%/);
 assert.match(html,/К оплате по С-3а<\/span><b>1[\s ]550[\s ]824,06/);
 assert.match(html,/ДС № 4 к дог. № 21/);
 assert.match(html,/С-29 за октябрь/);assert.match(html,/срок 15\.11/);
 assert.doesNotMatch(html,/undefined|NaN/);
});

test('director sees the same page without a single action',()=>{
 const html=objectPage(fixture('director'));
 assert.doesNotMatch(html,/Ваш ход|data-action="(estimate|allocate|review|close|open-period)"/);
 assert.match(html,/Проверяет и закрывает начальник ПТО/);
});

test('close conditions and contract term',()=>{
 const {data}=fixture();
 let c=closeConditions(data,'p1','2026-10');assert.deepEqual(c.map(x=>x.ok),[false,false,false,false]);
 data.workflows[0].step_code='accepted';data.workflows[1].step_ordinal=4;
 data.workflows.push(wf('w29','c29','accepted',{contract_id:'c21'}));
 data.skips=[{template_code:'sub_claim',contract_id:'s12',project_id:'p1',reason:'нет ДС'}];
 data.periods[0].reviewed_revision=3;
 c=closeConditions(data,'p1','2026-10');assert.deepEqual(c.map(x=>x.ok),[true,true,true,true]);
 assert.equal(termPassed({work_start_date:'2026-01-01',current_end_date:'2026-12-31'},'2026-07-02'),50);
 assert.equal(termPassed({current_end_date:'2026-12-31'},'2026-07-02'),null);
 assert.equal(objectTab('summary'),'month');assert.equal(objectTab('history'),'history');
});

test('other tabs: contracts grouped by side, documents grouped by kit, history filtered by kind',()=>{
 const ctx=fixture();ctx.ui.projectTab='contracts';let html=objectPage(ctx);
 assert.match(html,/С заказчиком<\/td>/);assert.match(html,/Субподряда<\/td>/);
 assert.match(html,/ДС № 4 в работе/);assert.match(html,/прошло 77 % срока/);
 ctx.ui.projectTab='documents';html=objectPage(ctx);
 assert.match(html,/Процентовка заказчику · дог\. № 21 · У технадзора/);assert.match(html,/data-action="doc" data-id="d1"/);
 ctx.ui.projectTab='history';ctx.data.events=[{id:1,project_id:'p1',action:'revise',actor:'u1',created_at:'2026-10-08T10:00:00Z',detail:{reason:'исправлен объём'}},{id:2,project_id:'p1',action:'update_contract',actor:'u1',created_at:'2026-10-08T11:00:00Z',detail:{}}];
 ctx.ui.historyKind='document';html=objectPage(ctx);
 assert.match(html,/исправлен объём/);assert.doesNotMatch(html,/Изменены условия договора/);
});
