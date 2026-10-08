import test from 'node:test';
import assert from 'node:assert/strict';
import {columnOf,expectedCards,objectColor,OBJECT_COLORS} from '../src/conveyor.js';

test('database steps map onto the six shared columns',()=>{
 const col=(template_code,step_code)=>columnOf({template_code,step_code});
 assert.equal(col('claim','prepared'),'acts');assert.equal(col('claim','site'),'acts');assert.equal(col('claim','supervision'),'tn');
 assert.equal(col('claim','customer'),'check');assert.equal(col('claim','signed'),'ok');
 for(const s of ['scan','accounting','accepted','closed'])assert.equal(col('claim',s),'acc');
 assert.equal(col('sub_claim','received'),'check');assert.equal(col('sub_claim','agreed'),'ok');assert.equal(col('sub_claim','accepted'),'acc');
 assert.equal(col('c29','formation'),'acts');assert.equal(col('c29','review'),'check');assert.equal(col('c29','closed'),'acc');
});

test('"waiting for volumes" lists active contracts without a kit and objects without С-29',()=>{
 const projects=[{id:'a'},{id:'b'}];
 const contracts=[
  {id:'c1',project_id:'a',number:'1',direction:'outgoing',our_role:'contractor'},
  {id:'c2',project_id:'a',number:'2',direction:'incoming',our_role:'customer',party:'Мегалит'},
  {id:'c3',project_id:'b',number:'3',direction:'outgoing',our_role:'subcontractor',current_end_date:'2026-08-31'},
  {id:'c4',project_id:'b',number:'4',direction:'incoming',our_role:'buyer'}];
 let list=expectedCards({projects,contracts,workflows:[]},'2026-09');
 assert.deepEqual(list.map(x=>x.template_code+':'+(x.contract_number||x.project_id)),['claim:1','sub_claim:2','c29:a'],'истёкший договор и поставка не ожидаются');
 list=expectedCards({projects,contracts,workflows:[{template_code:'claim',contract_id:'c1',project_id:'a'},{template_code:'c29',contract_id:'c1',project_id:'a'}]},'2026-09');
 assert.deepEqual(list.map(x=>x.template_code),['sub_claim']);
});

test('object colours avoid red and orange and are stable by object order',()=>{
 for(const c of OBJECT_COLORS){const [r,g,b]=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));assert.ok(!(r>180&&g<140&&b<100),c);}
 assert.equal(objectColor([{id:'x'},{id:'y'}],'y'),OBJECT_COLORS[1]);
});
