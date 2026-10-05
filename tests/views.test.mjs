import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWorkspace} from '../src/views.js';

function fixture(role='head') {
 const profile={id:'user',display_name:'Тестовый сотрудник',role,active:true};
 const data={
  projects:[{id:'object',name:'Объект <script>alert(1)</script>',address:'Адрес & корпус'}],
  contracts:[{id:'contract',project_id:'object',number:'Д-1',party:'Контрагент',direction:'outgoing'}],
  periods:[{id:'period',project_id:'object',status:'open',revision:2,reviewed_revision:1}],
  profiles:[profile],memberships:[],allocations:[],events:[],
  documents:[{id:'act',project_id:'object',period_id:'period',contract_id:'contract',kind:'c2a',number:'1',status:'draft',current_version:'new',accepted_version:'old',due_date:'2026-10-10'}],
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
 ctx.ui.flowProject='another-object';assert.doesNotMatch(renderWorkspace(ctx),/data-id="act"/);
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

test('object tabs preserve role and period gates for work actions',()=>{
 for(const role of ['head','engineer','accountant','admin']){
  const ctx=fixture(role);ctx.ui.route='project';
  for(const tab of ['summary','contracts','subcontract','month','acts','documents','history']){
   ctx.ui.projectTab=tab;const html=renderWorkspace(ctx);
   assert.equal(html.includes('data-action="new-doc"'),['head','engineer'].includes(role));
   assert.equal(html.includes('data-action="close"'),role==='head');
  }
  ctx.data.periods[0].status='closed';const html=renderWorkspace(ctx);
  assert.doesNotMatch(html,/data-action="new-doc"|data-action="close"/);
  assert.equal(html.includes('data-action="reopen"'),role==='admin');
 }
});
