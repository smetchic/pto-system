import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAmounts,deltaPercent,c29Deadline,claimStatus,c29Status,portfolioPage,objectListPage} from '../src/portfolio.js';

const now=Date.parse('2026-11-12T12:00:00Z');
const wf=(over)=>({project_id:'p',template_code:'claim',step_code:'supervision',step_label:'Технадзор',step_ordinal:3,last_event_at:'2026-11-08T12:00:00Z',...over});

test('object amounts come from the register matrix: object subtotal, or the single contract row',()=>{
 const m={rows:[{kind:'contract',project_id:'a',total:'10.00',own:'7.00',subcontract:'3.00'},
  {kind:'contract',project_id:'b',total:'1.00',own:'1.00',subcontract:'0.00'},{kind:'contract',project_id:'b',total:'2.00',own:'2.00',subcontract:'0.00'},
  {kind:'project',project_id:'b',total:'3.00',own:'3.00',subcontract:'0.00'}]};
 assert.deepEqual(projectAmounts(m,'a'),{total:'10.00',own:'7.00',subcontract:'3.00'});
 assert.equal(projectAmounts(m,'b').total,'3.00');
 assert.equal(projectAmounts(m,'none').total,'0.00');
 assert.equal(projectAmounts([],'a').total,'0.00','пустой ответ базы');
});

test('change to the previous month and the С-29 deadline',()=>{
 assert.equal(deltaPercent('1973259.89','1761839.19'),12);
 assert.equal(deltaPercent('90','100'),-10);
 assert.equal(deltaPercent('10','0'),null);
 assert.equal(c29Deadline('2026-10'),'2026-11-15');
 assert.equal(c29Deadline('2026-12'),'2027-01-15');
});

test('customer claim status: lagging kit, days on step, return, signed and accepted',()=>{
 assert.deepEqual(claimStatus([],'p',now),{text:'Не начата',cls:'n'});
 assert.equal(claimStatus([wf()],'p',now).text,'Технадзор · 4 дн.');
 assert.equal(claimStatus([wf(),wf({step_code:'accepted',step_ordinal:8})],'p',now).text,'Технадзор · 4 дн.','показывается отстающий комплект');
 assert.equal(claimStatus([wf({last_event_kind:'return',last_note:'нет визы'})],'p',now).cls,'o');
 assert.equal(claimStatus([wf({step_code:'signed',step_label:'Подписана заказчиком',step_ordinal:5})],'p',now).signed,true);
 assert.equal(claimStatus([wf({step_code:'accounting',step_ordinal:7})],'p',now).text,'В бухгалтерии · 4 дн.');
 assert.equal(claimStatus([wf({step_code:'closed',step_ordinal:9})],'p',now).done,true);
});

test('С-29 status: not started, who holds it, soon due, overdue, accepted',()=>{
 const c=(over)=>wf({template_code:'c29',step_code:'site',step_label:'У прораба',step_ordinal:2,...over});
 let s=c29Status([],'p','2026-10','2026-11-03',now);assert.equal(s.text,'Не начат');assert.equal(s.soon,undefined);
 s=c29Status([c()],'p','2026-10','2026-11-12',now);assert.equal(s.text,'В работе · у прораба · 4 дн.');assert.equal(s.soon,3);
 assert.equal(c29Status([c({step_code:'review'})],'p','2026-10','2026-11-03',now).text,'В работе · у ПТО · 4 дн.');
 s=c29Status([],'p','2026-10','2026-11-16',now);assert.equal(s.cls,'e');assert.match(s.text,/^Просрочен · Не начат/);
 assert.equal(c29Status([c({step_code:'accounting'})],'p','2026-10','2026-11-16',now).cls,'b','переданный в бухгалтерию не просрочен');
 assert.equal(c29Status([c({step_code:'accepted'})],'p','2026-10','2026-11-20',now).text,'Принят');
});

test('portfolio page: band from the database total, tiles without address, engineer name, negative own forces highlighted',()=>{
 const data={projects:[{id:'p',name:'Пружаны <b>',full_name:'Жилой дом',address:'Адрес не показывается'}],
  profiles:[{id:'u',display_name:'Надя',role:'engineer'},{id:'h',display_name:'Начальник',role:'head'}],memberships:[{project_id:'p',user_id:'u'}],
  periods:[{project_id:'p',status:'closed'}],workflows:[wf()],
  matrix:{rows:[{kind:'contract',project_id:'p',total:'1105416.15',own:'-224583.85',subcontract:'1330000.00'}],total:{total:'1105416.15',own:'-224583.85',subcontract:'1330000.00'}},
  prevMatrix:{rows:[{kind:'contract',project_id:'p',total:'1290000.00'}],total:{total:'1290000.00'}}};
 const html=portfolioPage({ui:{month:'2026-10'},data,profile:{role:'head'},today:'2026-11-12',now,view:'tiles'});
 assert.match(html,/Пружаны &lt;b&gt;/);assert.doesNotMatch(html,/Адрес не показывается/);
 assert.match(html,/class="eng">Надя</);assert.match(html,/1[\s ]105[\s ]416,15/);
 assert.match(html,/▼ 14%/);assert.match(html,/own neg[^>]*>-224[\s ]583,85/);
 assert.match(html,/Месяц закрыт <b>1 из 1/);assert.match(html,/до 15\.11/);
 assert.doesNotMatch(html,/Добавить объект|\bNaN\b|undefined/);
 const table=portfolioPage({ui:{month:'2026-10'},data,profile:{role:'director'},today:'2026-11-12',now,view:'table'});
 assert.match(table,/class="num neg"[^>]*>-224[\s ]583,85</);
});

test('objects list: only the head adds objects',()=>{
 const data={projects:[{id:'p',name:'Пружаны'}],profiles:[],memberships:[]};
 assert.match(objectListPage({data,profile:{role:'head'}}),/data-action="new-project"/);
 assert.doesNotMatch(objectListPage({data,profile:{role:'engineer'}}),/data-action="new-project"/);
});
