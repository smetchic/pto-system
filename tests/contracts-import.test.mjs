import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContractsFile,previewContracts,previewHtml,working} from '../src/contracts-import.js';
import {expectedCards} from '../src/conveyor.js';

const file={format:'pto-contracts',version:1,contracts:[
 {key:'ПРУЖАНЫ/03_32 ТОПАГРОБЕЛ',object:'ПРУЖАНЫ',type:'mps_su22_sub',kind:'customer:subcontractor',counterparty:{unp:'690845186',name:'ООО «ТОПАГРОБЕЛ»',full_name:'Общество «ТОПАГРОБЕЛ»'},
  number:'32',date:'2026-03-16',amount_with_vat:'353264.30',vat_amount:'58877.38',parts:[{name:'Договор',vat_mode:'vat',vat_rate:20,amount_with_vat:'353264.30'}],
  work_start:'2026-03-16',work_end:'2026-04',parent:{number:'21'},confidence:'high',check:[],files:[{type:'contract',path:'ПРУЖАНЫ/03_32/Договор.pdf'}],
  addenda:[{number:'1',date:'2026-03-20',amount_with_vat_after:'432863.48',signed:null},{number:'2',date:null,signed:null}]},
 {key:'ПРУЖАНЫ/21-01',object:'ПРУЖАНЫ',type:'su22_sub',kind:'customer:subcontractor',counterparty:{unp:null,name:'ГеоМонолитКомплект'},number:'21-01/2026',date:null,
  parts:[{name:'Жилая часть',vat_mode:'vat',vat_rate:20,amount_with_vat:'100.00'},{name:'Встроенные',vat_mode:'no_vat',vat_rate:null,amount_with_vat:'50.00'}],confidence:'low',check:['УНП'],addenda:[]},
 {key:'КОБРИН/МПС-Заказчик',object:'КОБРИН',type:'mps_customer',kind:'contractor:customer',counterparty:{name:'СИТОМО'},number:null,confidence:'low',addenda:[],parts:[]},
 {key:'КОБРИН/МПС-Заказчик-2',object:'КОБРИН',type:'mps_customer',kind:'contractor:customer',counterparty:{name:'СИТОМО'},number:null,confidence:'low',addenda:[],parts:[]}]};

test('contracts file: roles from kind, month-only term, VAT of a single part, parts only when two or more, confidence → checked',()=>{
 assert.throws(()=>parseContractsFile('{"format":"x"}'),/pto-contracts/);
 const [a,b]=parseContractsFile(JSON.stringify(file));
 assert.deepEqual([a.our_role,a.counterparty_role,a.work_end,a.vat_rate,a.parts.length,a.checked,a.parent_number,a.unp],['customer','subcontractor','2026-04-30','20',0,true,'21','690845186']);
 assert.deepEqual(a.addenda[0],{number:'1',date:'2026-03-20',amount_after:'432863.48',vat_amount_after:null,work_end_after:null,note:'',signed:null});
 assert.deepEqual(b.parts,[{name:'Жилая часть',vat_rate:'20',amount:'100.00'},{name:'Встроенные',vat_rate:'0',amount:'50.00'}]);
 assert.equal(b.checked,false);
});

test('contracts preview: grouped by object, existing object ticked, update vs new, duplicates and dateless addenda flagged',()=>{
 const data={projects:[{id:'p1',name:'Пружаны'}],contracts:[{id:'c1',project_id:'p1',number:'21-01/2026',direction:'incoming'}]};
 const groups=previewContracts(data,parseContractsFile(JSON.stringify(file)));
 assert.deepEqual(groups.map(g=>[g.object,g.exists]),[['ПРУЖАНЫ',true],['КОБРИН',false]]);
 assert.deepEqual(groups[0].items.map(x=>x.state),['new','update']);
 assert.match(groups[0].items[0].problems.join(),/ДС без номера или даты: 1/);
 assert.deepEqual(groups[1].items.map(x=>x.state),['new','skip']);assert.match(groups[1].items[0].problems.join(),/«б\/н»/);
 const html=previewHtml(groups);
 assert.match(html,/value="ПРУЖАНЫ" checked/);assert.doesNotMatch(html,/value="КОБРИН" checked/);assert.match(html,/не загрузится 1/);
});

test('reference and unchecked contracts do not create expectations on the signing board',()=>{
 const contracts=[{id:'a',project_id:'p',number:'1',direction:'outgoing',our_role:'contractor',contract_type:'mps_customer'},
  {id:'b',project_id:'p',number:'2',direction:'incoming',our_role:'customer',checked:false},
  {id:'c',project_id:'p',number:'3',direction:'incoming',our_role:'customer',checked:true,contract_type:'su22_sub'}];
 assert.deepEqual(expectedCards({projects:[{id:'p'}],contracts,workflows:[]},'2026-10').map(x=>x.contract_id),['c']);
 assert.deepEqual(contracts.map(working),[false,false,true]);
});
