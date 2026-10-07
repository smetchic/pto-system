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
  documents:[{id:'act',project_id:'object',period_id:'period',contract_id:'contract',kind:'c2a',number:'1',current_version:'new',accepted_version:'old',due_date:'2026-10-10',workflow_id:'kit',step_code:'site',step_label:'У прораба'}],
  templates:[{code:'claim',name:'Процентовка заказчику',money:true,ordinal:1},{code:'c29',name:'С-29',money:false,ordinal:3}],
  steps:[{template_code:'claim',code:'prepared',ordinal:1,label:'Подготовлена ПТО',actor:'pto',requires:[]},{template_code:'claim',code:'site',ordinal:2,label:'У прораба',actor:'pto',requires:['kit','person']},
   {template_code:'claim',code:'accounting',ordinal:3,label:'Оригинал в бухгалтерии',actor:'accounting',requires:['kit']},{template_code:'claim',code:'accepted',ordinal:4,label:'Принято бухгалтерией',actor:'accounting',requires:['accept']},
   {template_code:'c29',code:'formation',ordinal:1,label:'Формирование ПТО',actor:'pto',requires:[]}],
  workflows:[{id:'kit',template_code:'claim',template_name:'Процентовка заказчику',money:true,project_id:'object',project:'Объект <script>alert(1)</script>',period_id:'period',contract_id:'contract',contract_number:'Д-1',party:'Контрагент',
   step_code:'site',step_label:'У прораба',step_ordinal:2,actor:'pto',documents:1,acts_amount:'9999.00',last_event_kind:'return',last_note:'Нет подписи <i>',last_event_at:new Date(Date.now()-3*86400000).toISOString()}],
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

test('conveyor shows one board per route with stages from the template; quick step only for the acting role',()=>{
 const ctx=fixture();ctx.ui.route='flow';let html=renderWorkspace(ctx);
 assert.match(html,/\u041f\u0440\u043e\u0446\u0435\u043d\u0442\u043e\u0432\u043a\u0430 \u0437\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0443/);assert.match(html,/data-action="flow-template" data-id="c29"/);
 for(const label of ['\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0430 \u041f\u0422\u041e','\u0423 \u043f\u0440\u043e\u0440\u0430\u0431\u0430','\u041e\u0440\u0438\u0433\u0438\u043d\u0430\u043b \u0432 \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u0438','\u041f\u0440\u0438\u043d\u044f\u0442\u043e \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u0435\u0439'])assert.match(html,new RegExp(label));
 assert.match(html,/data-action="wf-advance" data-id="kit">\u2192 \u041e\u0440\u0438\u0433\u0438\u043d\u0430\u043b \u0432 \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u0438/);
 assert.match(html,/\u0412\u043e\u0437\u0432\u0440\u0430\u0442: \u041d\u0435\u0442 \u043f\u043e\u0434\u043f\u0438\u0441\u0438 &lt;i&gt;/);assert.match(html,/proc-corner red/);
 assert.doesNotMatch(renderWorkspace(fixture('director')),/data-action="wf-advance"/,'руководитель шаги не отмечает');
 {const other=fixture('engineer');other.data.memberships=[];other.ui.route='flow';assert.doesNotMatch(renderWorkspace(other),/data-action="wf-advance"/,'инженер видит конвейер чужого объекта, но шаги не отмечает');}
 assert.doesNotMatch(renderWorkspace(fixture('director')),/data-action="wf-advance"/,'\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u0448\u0430\u0433\u0438 \u043d\u0435 \u043e\u0442\u043c\u0435\u0447\u0430\u0435\u0442');
 ctx.ui.flowTemplate='c29';html=renderWorkspace(ctx);assert.match(html,/\u0424\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u041f\u0422\u041e/);assert.doesNotMatch(html,/\u0440\u0443\u0431\. \u00b7 \u0441\u0440\./,'\u0443 \u0421-29 \u043d\u0435\u0442 \u0441\u0443\u043c\u043c');
});

test('Today lists kits awaiting PTO and, separately, kits at accounting that PTO marks',()=>{
 const ctx=fixture();let html=renderWorkspace(ctx);
 assert.match(html,/\u0422\u0440\u0435\u0431\u0443\u0435\u0442 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439 \u041f\u0422\u041e/);assert.match(html,/\u041f\u0440\u043e\u0446\u0435\u043d\u0442\u043e\u0432\u043a\u0430 \u0437\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0443 \u00b7 \u0423 \u043f\u0440\u043e\u0440\u0430\u0431\u0430/);assert.match(html,/3 \u0434\u043d\./);
 assert.match(html,/\u0412 \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u0438 \u043d\u0435\u0442 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0442\u043e\u0432/);
 ctx.data.workflows[0].actor='accounting';html=renderWorkspace(ctx);
 assert.match(html,/\u041d\u0435\u0442 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0442\u043e\u0432, \u043e\u0436\u0438\u0434\u0430\u044e\u0449\u0438\u0445 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439 \u041f\u0422\u041e/);assert.match(html,/\u0423 \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u0438[\s\S]*\u041f\u0440\u043e\u0446\u0435\u043d\u0442\u043e\u0432\u043a\u0430 \u0437\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0443 \u00b7 \u0423 \u043f\u0440\u043e\u0440\u0430\u0431\u0430/);
 assert.match(renderWorkspace({...ctx,ui:{...ctx.ui,route:'flow'}}),/data-action="wf-advance"/,'\u0448\u0430\u0433 \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u0438 \u043e\u0442\u043c\u0435\u0447\u0430\u0435\u0442 \u041f\u0422\u041e');
 assert.doesNotMatch(html,/data-action="view-as"|\u0411\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u044f<\/button>/);
});

test('negative own forces are shown and highlighted, not hidden',()=>{
 const ctx=fixture();ctx.data.register[0].subcontract=324.58;
 ctx.data.matrix.rows[0].own=ctx.data.matrix.total.own='-224.58';
 for(const route of ['register','objects']){ctx.ui.route=route;ctx.ui.portfolioView='table';
  assert.match(renderWorkspace(ctx),/class="num neg"[^>]*>-224,58</,route);}
 ctx.ui.route='project';ctx.ui.projectTab='month';assert.match(renderWorkspace(ctx),/<b class="neg"[^>]*>-224,58</);
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
 ctx.ui.route='project';ctx.ui.projectTab='month';assert.match(renderWorkspace(ctx),/Оперативная оценка · предварительно/);
});

test('contracts tab shows computed current price and term and opens the contract card',()=>{
 const ctx=fixture();ctx.ui.route='project';ctx.ui.projectTab='contracts';
 Object.assign(ctx.data.contracts[0],{current_amount:'159559.72',amount_addendum_number:'1',current_end_date:'2000-01-31'});
 const html=renderWorkspace(ctx);
 assert.match(html,/data-action="contract" data-id="contract"/);
 assert.match(html,/159[\s ]559,72<small>по ДС №1/);
 assert.match(html,/Истёк · 31\.01\.2000/);
 ctx.data.contracts[0].current_amount=null;assert.match(renderWorkspace(ctx),/<td class="num"><span class="muted">—<\/span>/);
});

test('object tabs preserve role and period gates for work actions',()=>{
 for(const [role,assigned] of [['head',false],['engineer',true],['engineer',false],['director',true]]){
  const ctx=fixture(role);ctx.ui.route='project';if(!assigned)ctx.data.memberships=[];
  const writer=role==='head'||(role==='engineer'&&assigned);
  for(const tab of ['summary','contracts','subcontract','month','acts','documents','history']){
   ctx.ui.projectTab=tab;const html=renderWorkspace(ctx);
   assert.equal(html.includes('data-action="new-doc"'),writer);
   assert.equal(html.includes('data-action="close"'),role==='head');
  }
  ctx.data.periods[0].status='closed';const html=renderWorkspace(ctx);
  assert.doesNotMatch(html,/data-action="new-doc"|data-action="close"/);
  assert.equal(html.includes('data-action="reopen"'),role==='head');
 }
});
