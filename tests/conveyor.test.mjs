import test from 'node:test';
import assert from 'node:assert/strict';
import {COLUMNS,columnOf,turnOf,expectedCards,objectColor,OBJECT_COLORS} from '../src/conveyor.js';

test('step codes are the six shared columns; the move wording follows the route',()=>{
 for(const [c] of COLUMNS)assert.equal(columnOf({step_code:c}),c);
 assert.equal(turnOf({template_code:'claim',step_code:'tn'}),'отправить заказчику');
 assert.equal(turnOf({template_code:'claim',step_code:'check'}),'отметить «Заказчик подписал»');
 assert.equal(turnOf({template_code:'sub_claim',step_code:'check'}),'отметить «Комплект получен»','сначала получение комплекта');
 assert.equal(turnOf({template_code:'sub_claim',step_code:'check',received_on:'2026-10-06'}),'отметить «Проверено»');
 assert.equal(turnOf({template_code:'claim',step_code:'accepted'}),'','после передачи в бухгалтерию шагов нет');
});

test('"waiting for volumes" lists active contracts without a kit or skip, and objects without С-29',()=>{
 const projects=[{id:'a'},{id:'b'}];
 const contracts=[
  {id:'c1',project_id:'a',number:'1',direction:'outgoing',our_role:'contractor'},
  {id:'c2',project_id:'a',number:'2',direction:'incoming',our_role:'customer',party:'Мегалит'},
  {id:'c3',project_id:'b',number:'3',direction:'outgoing',our_role:'subcontractor',current_end_date:'2026-08-31'},
  {id:'c4',project_id:'b',number:'4',direction:'incoming',our_role:'buyer'}];
 let list=expectedCards({projects,contracts,workflows:[]},'2026-09');
 assert.deepEqual(list.map(x=>x.template_code+':'+(x.contract_number||x.project_id)),['claim:1','sub_claim:2','c29:1'],'истёкший договор и поставка не ожидаются');
 assert.deepEqual(list.map(x=>x.key),['claim:c1','sub_claim:c2','c29:c1'],'С-29 начинается по договору объекта');
 list=expectedCards({projects,contracts,workflows:[{template_code:'claim',contract_id:'c1',project_id:'a'},{template_code:'c29',contract_id:'c1',project_id:'a'}]},'2026-09');
 assert.deepEqual(list.map(x=>x.template_code),['sub_claim']);
 list=expectedCards({projects,contracts,workflows:[],skips:[{template_code:'sub_claim',contract_id:'c2',project_id:'a'}]},'2026-09');
 assert.deepEqual(list.map(x=>x.template_code),['claim','c29'],'снятое ожидание не показывается');
});

test('object colours avoid red and orange and are stable by object order',()=>{
 for(const c of OBJECT_COLORS){const [r,g,b]=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));assert.ok(!(r>180&&g<140&&b<100),c);}
 assert.equal(objectColor([{id:'x'},{id:'y'}],'y'),OBJECT_COLORS[1]);
});

test('in each column our claims come first, then subcontractors, then С-29',async()=>{
 const {conveyorPage}=await import('../src/conveyor.js');
 const w=(id,template_code)=>({id,template_code,step_code:'tn',step_label:'У технадзора',project_id:'a',project:'А',contract_id:'k'+id,contract_number:id,party:'X',open_notes:[]});
 const data={projects:[{id:'a',name:'А'}],contracts:[],workflows:[w('1','c29'),w('2','sub_claim'),w('3','claim'),w('4','sub_claim')],skips:[],memberships:[],profiles:[]};
 const html=conveyorPage({ui:{},data,profile:{role:'head'},month:'2026-10',now:Date.parse('2026-10-10')});
 const kinds=[...html.matchAll(/<span class="cv-kind">([^<]+)<\/span>/g)].map(m=>m[1]);
 assert.deepEqual(kinds,['Наша','Субподряд','Субподряд','С-29']);
});
